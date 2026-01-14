// https://tp-back.starlight.digital/ua/show/stb/ukraina-mae-talant/sezon-2021/vypusk-5
// https://teleportal.ua/ua/show/stb/ukraina-mae-talant/sezon-2021/vypusk-4
const { fromPromise } = require("rxjs/internal/observable/innerFrom");
const fetch = require("node-fetch");
const stepEnum = require(`${__dirname}/../step-enum-util`);
const cp = require("child_process");
const { switchMap, tap, map, of, throwError } = require("rxjs");
const fs = require("fs");
const playerLink = "https://fayvlad.github.io/player/?source=";

class Worker {
  constructor(link) {
    console.log("Worker constructor - teleportal");
    this.html = "";
    this.title = "";
    this.fileName = "";
    this.href = "";
    this.hashId = [];
    this.pageLink = link;
    this.teleportalApiUrl =
      "https://vcms-api2.starlight.digital/player-api/{{hash}}?referer={{referer}}&lang=ua";
  }

  get parseOrUploadKeyboard() {
    return [
      [
        {
          text: "Parse (add to playlist)",
          callback_data: stepEnum.WORKER_PARSE,
        },
        // {text: `Upload to local store`, callback_data: stepEnum.WORKER_UPLOAD},
        { text: "Get link", callback_data: stepEnum.WORKER_GET_LINK },
      ],
    ];
  }

  _writeToPlaylist(data) {
    const path = `download/m3u/parser${data.type === "lq" ? ".lq" : ""}.m3u`;
    // Const path = `/mnt/video/playlists/m3u/parser${data.type === 'lq' ? '.lq' : ''}.m3u`;

    fs.appendFileSync(path, `#EXTINF:0,${data.title}\n`);
    fs.appendFileSync(path, `${data.playlistLink}\n`);
  }

  _loadPage(link) {
    return fromPromise(
      fetch(link, {
        referrer: link,
        headers: { accept: "*/*" },
        referrerPolicy: "no-referrer-when-downgrade",
      }),
    );
  }

  _decodeUrlFromText = (href) => [
    ...decodeURIComponent(href).matchAll(/file=(http.+?m3u8)?\?/g),
  ];

  _prepareResult() {
    const addonLink = "http://192.168.1.200/m3u/tv/";
    // Const addonLink = 'http://192.168.1.200/m3u/tv/';
    return this._decodeUrlFromText(this.href).map((itm) => {
      const link = itm[1];
      const type = link.match(/(\w*)\.mp4/)[1];
      const name = `${this.fileName}.${type}.m3u8`;

      return {
        link,
        name,
        type,
        title: this.title,
        playlistLink: `${addonLink}${name}`,
      };
    });
  }

  parse() {
    const download = async (uri, filename) =>
      cp.execSync(`curl -k -o ${filename}  '${uri}'`);
    return this._prepareResult().map(async (film) => {
      this._writeToPlaylist(film);
      await download(film.link, `${__dirname}/download/m3u/tv/${film.name}`);
      // Await download(film.link, `/mnt/video/playlists/m3u/tv/${film.name}`)
    });
  }

  getLinks() {
    return this._prepareResult().map((item) =>
      of({
        link: `${playerLink}${encodeURIComponent(item.link)}`,
        name: this.title,
        quality: item.type,
        qualityLinkList: [],
      }),
    );
  }

  getHtml(link) {
    return this._loadPage(link).pipe(
      switchMap((data) => fromPromise(data.text())),
    );
  }

  getJson(link) {
    return this._loadPage(link).pipe(
      switchMap((data) => fromPromise(data.json())),
    );
  }

  loadPage() {
    return this.getHtml(this.pageLink).pipe(
      switchMap((data) => {
        this.html = data;
        this.hashId = data.match(/"hash":"(.*?)"/) || [];
        if (!this.hashId.length) {
          const link = this.pageLink.replace(
            "teleportal.ua",
            "tp-back.starlight.digital",
          );
          return this.getJson(link).pipe(
            map((pageJson) => {
              this.hashId[1] = pageJson.hash;

              if (!this.hashId[1]) {
                throw new Error("не знайшов hash");
              }

              return of(this.hashId);
            }),
          );
        }

        return of(this.hashId);
      }),
      switchMap(() => {
        const link = this.teleportalApiUrl
          .replace("{{hash}}", this.hashId[1])
          .replace("{{referer}}", "https://teleportal.ua/");
        return this.getJson(link).pipe(map((apiJson) => apiJson.video[0]));
      }),
      tap((video) => {
        this.href = video.mediaHlsNoAdv;
        this.fileName = video.program;
        this.title = `${video.projectName}-${video.releaseName}-${video.seasonName}`;

        if (!this.href) {
          throw new Error("не знайшов відео");
        }
      }),
      map(() => stepEnum.WORKER_PARSE_OR_UPLOAD),
    );
  }
}

module.exports = Worker;

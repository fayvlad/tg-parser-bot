// https://tp-back.starlight.digital/ua/show/stb/ukraina-mae-talant/sezon-2021/vypusk-5
// https://teleportal.ua/ua/show/stb/ukraina-mae-talant/sezon-2021/vypusk-4
// rxjs innerFrom removed; ProviderBase.getHtml/getJson use fetch internally
const stepEnum = require(`${__dirname}/../step-enum-util`);
const cp = require("child_process");
const { switchMap, tap, map, of, forkJoin } = require("rxjs");
// const fs = require("fs"); // fs is handled in ProviderBase if needed
const playerLink = "https://fayvlad.github.io/player/?source=";
const ProviderBase = require(`${__dirname}/provider.base`);

class Worker extends ProviderBase {
  constructor(link) {
    super(link);
    console.log("Worker constructor - teleportal");
    this.title = "";
    this.fileName = "";
    this.href = "";
    this.itemList = "";
    this.hashId = [];
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

  // use ProviderBase implementations for playlist helpers and page loading

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
    if (this.itemList && Array.isArray(this.itemList) && this.itemList.length) {
      return this.itemList
        .filter((it) => it.media)
        .map((it) => {
          this.href = it.media;
          const list = this._prepareResult().map((item) => ({
            link: `${playerLink}${encodeURIComponent(item.link)}`,
            name: `${this.title}_${it.name}`,
            quality: item.type,
            qualityLinkList: [],
          }));
          return of(list.at(0));
        });
    }

    // Fallback to existing _prepareResult flow
    return this._prepareResult().map((item) =>
      of({
        link: `${playerLink}${encodeURIComponent(item.link)}`,
        name: this.title,
        quality: item.type,
        qualityLinkList: [],
      }),
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
              if (Boolean(!pageJson.hash && pageJson.seasonGallery)) {
                this.itemList = pageJson.seasonGallery.items.map((item) => {
                  return {
                    title: item.title,
                    hash: item.hash,
                    name: item.videoSlug,
                  };
                });
                return of(this.itemList);
              }
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
        if (
          this.itemList &&
          Array.isArray(this.itemList) &&
          this.itemList.length
        ) {
          // for each item (with hash) call API and collect first video entry
          const calls = this.itemList.map((item) => {
            const url = this.teleportalApiUrl
              .replace("{{hash}}", item.hash)
              .replace("{{referer}}", "https://teleportal.ua/");
            return this.getJson(url).pipe(
              map((apiJson) => ({ item, apiJson })),
            );
          });
          return forkJoin(calls).pipe(
            map((results) => {
              const collected = results.map(({ item, apiJson }) => {
                const video = apiJson?.video || apiJson?.result?.video || [];
                const first = video[0] || null;
                const media =
                  first?.mediaHlsNoAdv || first?.media?.mediaHlsNoAdv || null;
                return {
                  title: item.title,
                  name: item.name,
                  hash: item.hash,
                  program: first?.program || null,
                  projectName: first?.projectName || null,
                  media,
                };
              });
              // store detailed list
              this.itemList = collected;
              return collected;
            }),
          );
        }

        const link = this.teleportalApiUrl
          .replace("{{hash}}", this.hashId[1])
          .replace("{{referer}}", "https://teleportal.ua/");
        return this.getJson(link).pipe(map((apiJson) => apiJson.video[0]));
      }),
      tap((videoOrList) => {
        if (Array.isArray(videoOrList)) {
          // we received a list of items with media
          const firstWithMedia = videoOrList.find((i) => i.media);
          if (!firstWithMedia) {
            throw new Error("не знайшов відео в перелiку itemList");
          }
          this.href = firstWithMedia.media;
          this.fileName = firstWithMedia.program || this.fileName;
          this.title =
            this.title || firstWithMedia.projectName || firstWithMedia.title;
        } else {
          const video = videoOrList;
          this.href = video.mediaHlsNoAdv;
          this.fileName = video.program;
          this.title = `${video.projectName}-${video.releaseName}-${video.seasonName}`;
        }

        if (!this.href) {
          throw new Error("не знайшов відео");
        }
      }),
      map(() => stepEnum.WORKER_PARSE_OR_UPLOAD),
    );
  }
}

module.exports = Worker;

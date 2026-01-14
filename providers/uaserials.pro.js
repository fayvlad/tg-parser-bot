const fetch = require("node-fetch");
const stepEnum = require(`${__dirname}/../step-enum-util`);
const cp = require("child_process");
const {
  from,
  switchMap,
  tap,
  map,
  of,
  forkJoin,
  take,
  iif,
  combineLatest,
} = require("rxjs");
const fs = require("fs");
const playerLink = "https://fayvlad.github.io/player/?source=";

const FilmTypeEnum = {
  FILM: 0,
  SERIES: 1,
  ANIME: 2,
  MULTFILMS: 3,
  SingleMULTFILM: 3.1,
  TVSHOWS: 4,
};

class Worker {
  constructor(link) {
    console.log("Worker constructor - uaserials.pro");
    this.html = "";
    this.title = this.extractTitle(link);
    this.fileName = "";
    this.href = "";
    this.season = null;
    this.hashId = [];
    this.filmType = FilmTypeEnum.SERIES;
    this.episodeList = new Map();
    this.translatorList = new Map();
    this.translatorId = null;
    this.playerList = null;
    this.pageLink = link;
    this.jsonFile = null;
    this._selectedEpisodes = [];
    this.id = this.extractId(link);
    this.apiUrl = `https://hdvbua.pro/embed/${this.id}`;
  }

  extractTitle(link) {
    return /(\d+)-(.*)\.html/gs.exec(link.split("/").at(-1))[2] || "unknown";
  }

  extractDomain(link) {
    const regex = /^https?:\/\/([^\/]+)\//;
    const match = link.match(regex);
    return match ? match[1] : null;
  }

  extractId(link) {
    return /(\d+)/gs.exec(link.split("/").at(-1))[0] || null;
  }

  toFile(chatId) {
    return combineLatest([...this.getLinks("")]).pipe(
      map((data) => {
        const dir = this.title
          .replaceAll("/", "-")
          .replaceAll("_-_", "-")
          .replaceAll(" ", "_");
        const downloadDir = `${__dirname}/../download`;
        const dirName = `${downloadDir}/${dir}/${this.season}`.replaceAll(
          " ",
          "_",
        );
        if (!fs.existsSync(dirName)) {
          fs.mkdirSync(dirName, { recursive: true });
        }

        const content = [];
        data
          .filter(Boolean)
          .forEach(
            ({ season, episode, name, quality, link, qualityLinkList }) => {
              const path = `download/${dir}/${this.season}`.replaceAll(
                " ",
                "_",
              );
              content.push({
                chatId,
                path,
                link,
                name: name.replaceAll(" ", "_"),
                translator: this.translatorId.replaceAll(" ", "_"),
                qualityLinkList,
              });
            },
          );
        this.jsonFile = `download/${dir}/${this.season}.json`.replaceAll(
          " ",
          "_",
        );
        fs.writeFileSync(this.jsonFile, JSON.stringify(content));
        return this.jsonFile;
      }),
    );
  }

  get parseOrUploadKeyboard() {
    return [
      [
        {
          text: "Parse (add to playlist)",
          callback_data: stepEnum.WORKER_PARSE,
        },
        {
          text: "Get link",
          callback_data: stepEnum.WORKER_GET_LINK,
        },
        { text: "to file", callback_data: stepEnum.WORKER_TO_FILE },
      ],
    ];
  }

  get episodeListValues() {
    const seasonData = this.playerList.find(
      ({ title }) => title === this.season,
    )?.folder;
    const first = seasonData.at(0); // .find(({title}) => title === this.translatorId);
    return first?.folder;
  }

  get dividedEpisodeListValues() {
    const votes = this.episodeListValues;
    const result = [];

    if (votes.length === 1) {
      votes.push("do not select this!");
      return votes;
    }

    for (let i = 0; i < Math.ceil(votes.length / 9); i++) {
      const values = votes.slice(i * 9, i * 9 + 9).map((value) => value.title);
      result.push(["Skip this selection", ...values]);
    }

    return result;
  }

  get translatorKeyboard() {
    const inline_keyboard = this.playerList
      .find(({ title }) => title === this.season)
      ?.folder.map(({ title }) => [title, title])
      .reduce((keyboard, [callback_data, text]) => {
        keyboard.push([{ text, callback_data }]);
        return keyboard;
      }, []);
    return {
      reply_markup: {
        inline_keyboard,
      },
    };
  }

  get seasonKeyboard() {
    return {
      reply_markup: {
        inline_keyboard: this.playerList.reduce((keyboard, { title }) => {
          keyboard.push([
            {
              text: title,
              callback_data: title,
            },
            { text: `Select full "${title}"`, callback_data: `full:${title}` },
          ]);
          return keyboard;
        }, []),
      },
    };
  }

  set selectedEpisodes(val) {
    this._selectedEpisodes = val;
  }

  upload() {
    // Implementation of upload method
  }

  parse() {
    const path = "/mnt/video/playlists/m3u/uakino.m3u";

    forkJoin([...this.getLinks()])
      .pipe(
        tap((links) => {
          links.forEach((link, name) => {
            fs.appendFileSync(path, `#EXTINF:0,${name}\n`);
            fs.appendFileSync(path, `${link}\n`);
          });
        }),
        take(1),
      )
      .subscribe();
  }

  getNextStep(currentStep) {
    if (currentStep === stepEnum.WORKER_GET_TRANSLATOR) {
      return stepEnum.WORKER_PARSE_OR_UPLOAD;
    }

    if (currentStep === stepEnum.WORKER_GET_EPISODES) {
      if (this.filmType === FilmTypeEnum.SERIES && !this.translatorId) {
        const translators = this.playerList
          .find(({ title }) => title === this.season)
          ?.folder?.map(({ title }) => title);
        if (translators.length > 1) {
          return stepEnum.WORKER_GET_TRANSLATOR;
        }

        this.translatorId = translators[0];
      }
    }
  }

  _writeToPlaylist(data) {
    const path = `/mnt/video/playlists/m3u/parser${data.type === "lq" ? ".lq" : ""}.m3u`;

    fs.appendFileSync(path, `#EXTINF:0,${data.title}\n`);
    fs.appendFileSync(path, `${data.playlistLink}\n`);
  }

  _loadPage(link) {
    return fetch(link, {
      referrer: link,
      headers: {
        accept: "*/*",
        "x-requested-with": "XMLHttpRequest",
        "accept-language": "uk",
        "cache-control": "no-cache",
        pragma: "no-cache",
        priority: "u=1, i",
        "sec-ch-ua":
          '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        Referer: link,
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      referrerPolicy: "no-referrer-when-downgrade",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return response;
      })
      .catch((error) => {
        console.log(error);
        throw new Error(
          `Failed to load episode: ${error.message} | Request body: ${JSON.stringify(error)}`,
        );
      });
  }

  _decodeUrlFromText(href) {
    return [...decodeURIComponent(href).matchAll(/file=(http.+?m3u8)?\?/g)];
  }

  _prepareResult() {
    const addonLink = "http://192.168.1.200/m3u/tv/";
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

  getLinks(addLink = playerLink) {
    if (this.filmType === FilmTypeEnum.SERIES) {
      const season = this.playerList.find(
        ({ title }) => title === this.season,
      )?.folder;
      const translator = season.find(
        ({ title }) => title === this.translatorId,
      );
      return translator.folder
        .filter(
          ({ title }) =>
            !Array.isArray(this._selectedEpisodes) ||
            this._selectedEpisodes.includes(title),
        )
        .map(({ title, file }) =>
          of({
            name: title,
            link: `${addLink}${file}`,
            quality: this.translatorId,
          }),
        );
    }

    return [
      of({
        name: this.title,
        link: `${addLink}${this.playerList}`,
        quality: "hd",
      }),
    ];
  }

  getHtml(link) {
    return from(this._loadPage(link).then((data) => data.text()));
  }

  setSelectedEpisodesBySesone(val) {
    this._selectedEpisodes = this.season;
  }

  extractPlayerJsUrl(html) {
    const playerConfigRegex =
      /new Playerjs\({[\s\S]*?file:\s?['|"](.*)['|"],\n/;
    const match = html.match(playerConfigRegex);

    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        return match[1];
      }
    }

    return null;
  }

  loadPage() {
    const multiSeries = this.getHtml(this.apiUrl).pipe(
      tap((data) => {
        this.playerList = this.extractPlayerJsUrl(data);
      }),
      map(() => {
        this.filmType = Array.isArray(this.playerList)
          ? FilmTypeEnum.SERIES
          : FilmTypeEnum.FILM;
        const isSerial = this.filmType === FilmTypeEnum.SERIES;

        if (isSerial && !this.season) {
          return stepEnum.WORKER_GET_SEASON;
        }

        if (false) {
          return stepEnum.WORKER_GET_TRANSLATOR;
        }

        if (!isSerial) {
          return stepEnum.WORKER_PARSE_OR_UPLOAD;
        }

        return stepEnum.WORKER_GET_EPISODES;
      }),
    );

    return this.getHtml(this.pageLink).pipe(
      tap((html) => {
        this.html = html;
        this.title = this.parseMetaTag("og:title") || this.title;
      }),
      switchMap(() => multiSeries),
    );
  }

  getEpisodes() {
    return of(
      this.playerList.find(({ title }) => title === this.season)?.folder,
    );
  }

  parseMetaTag(tag) {
    const content =
      this.html.match(
        new RegExp(`<meta property="${tag}" content="([^"]*)"`),
      ) || [];
    return content[1];
  }
}

module.exports = Worker;

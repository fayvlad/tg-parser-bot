const fetch = require("node-fetch");
const stepEnum = require(`${__dirname}/../step-enum-util`);
const {
  from,
  of,
  switchMap,
  tap,
  map,
  BehaviorSubject,
  mergeAll,
  combineLatest,
  mergeMap,
  catchError,
  defer,
  retry,
  throwError,
} = require("rxjs");
const http = require("https");
const fs = require("fs");
const cheerio = require("cheerio");
const cookies = [];
const cookieJar = new Map();
let translatorList;

const FilmTypeEnum = {
  FILM: 0,
  SERIES: 1,
  ANIME: 2,
  MULTFILMS: 3,
  TVSHOWS: 4,
};

// Конфігурація для авторизації
const AUTH_CONFIG = {
  login: process.env.REZKA_LOGIN,
  password: process.env.REZKA_PASSWORD,
  domain: "rezka.fi",
};

class Worker {
  constructor(link) {
    console.log("Worker constructor - rezka");
    this.pageLink = link;
    this.filmType = this.getTypeByName(link.split("/")[3]);
    const parsedLink = link.match(
      /\/(\d+)(?:-[^\/]+)?(?:\/(\d+)(?:-[^\/]+)?)?(?:\/(\d+)(?:-[^\/]+)?)?/,
    );
    // This.translator_id = (link.match(/\/(\d+)+.+?[\/]*(\d+)?.+?[\/]?(\d+)?.+?/) || [])[1];
    this.translator_id = (parsedLink || [])[2];
    this.html = "";
    this.html$ = "";
    this.title = "";
    this.filmId = (parsedLink || [])[1];
    this.seasonId = (parsedLink || [])[3];
    // This.seasonId = (link.match(/#t:(\d+)?-s:(\d+)?/) || [])[2];
    this.domain = this.extractDomain(link);
    this.episodeList = new Map();
    this._selectedEpisodes = [];
    this.isAuthenticated = false;
    this.isBlocked = false;
  }

  extractDomain(link) {
    const regex = /^https?:\/\/([^\/]+)\//;
    const match = link.match(regex);
    return match ? match[1] : null;
  }

  parseCookies(setCookieHeaders) {
    setCookieHeaders.forEach((cookieHeader) => {
      const parts = cookieHeader.split(";");
      const cookiePart = parts[0].trim();
      const [name, value] = cookiePart.split("=");

      if (value === "deleted") {
        cookieJar.delete(name);
      } else {
        cookieJar.set(name, value);
      }
    });
  }

  async authenticate() {
    if (
      (this.isAuthenticated &&
        cookieJar.has("dle_user_id") &&
        cookieJar.has("dle_password")) ||
      this.domain !== AUTH_CONFIG.domain
    ) {
      return true;
    }

    try {
      console.log("Starting authentication...");

      const homeResponse = await fetch(`https://${this.domain}/`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.95 Safari/537.36",
        },
      });

      const homeCookies = homeResponse.headers.raw()["set-cookie"] || [];
      this.parseCookies(homeCookies);

      const body = new URLSearchParams({
        login_name: AUTH_CONFIG.login,
        login_password: AUTH_CONFIG.password,
        login_not_save: "0",
      });

      const response = await fetch(`https://${this.domain}/ajax/login/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.95 Safari/537.36",
          Referer: `https://${this.domain}/`,
          Cookie: this.getCookieString(),
        },
        body: body.toString(),
      });

      const setCookiesHeaders = response.headers.raw()["set-cookie"] || [];
      this.parseCookies(setCookiesHeaders);

      const data = await response.json();

      // Console.log('Auth response:', data);
      // console.log('Cookies after auth:', Array.from(cookieJar.entries()));

      if (
        data.success ||
        (cookieJar.has("dle_user_id") && cookieJar.has("dle_password"))
      ) {
        console.log("Authentication successful");
        this.isAuthenticated = true;
        return true;
      }

      console.error("Authentication failed:", data);
      return false;
    } catch (error) {
      console.error("Authentication error:", error);
      return false;
    }
  }

  getCookieString() {
    const cookies = [];

    for (const [name, value] of cookieJar.entries()) {
      cookies.push(`${name}=${value}`);
    }

    const additionalCookies = {
      allowed_comments: "1",
      _ym_isad: "1",
      _ym_visorc: "b",
      dle_newpm: "0",
    };

    for (const [name, value] of Object.entries(additionalCookies)) {
      if (!cookieJar.has(name)) {
        cookies.push(`${name}=${value}`);
      }
    }

    return cookies.join("; ");
  }

  set translatorId(val) {
    this.translator_id = val;
  }

  set season(val) {
    this.seasonId = String(val || this.seasonId);
  }

  set selectedEpisodes(val) {
    this._selectedEpisodes = [...this.episodeList.get(this.seasonId)].filter(
      (item) => val.includes(item.name),
    );
  }

  get parseOrUploadKeyboard() {
    return [
      [
        // {text: `Upload to local store`, callback_data: stepEnum.WORKER_UPLOAD},
        { text: "Get link", callback_data: stepEnum.WORKER_GET_LINK },
        {
          text: "Upload to file",
          callback_data: stepEnum.WORKER_TO_FILE,
        },
      ],
    ];
  }

  setSelectedEpisodesBySesone(val) {
    this._selectedEpisodes = [...this.episodeList.get(val)];
  }

  getLinks() {
    return !this.episodeList.size
      ? [this.getMovieUrl()]
      : this.getEpisodesUrl();
    // Return !this.episodeList.size ? [this.getMovieUrl()] : this.getEpisodesUrl();
    // return this.filmType === FilmTypeEnum.FILM ? [this.getMovieUrl()] : this.getEpisodesUrl();
  }

  toFile() {
    return combineLatest([...this.getLinks()]).pipe(
      map((data) => {
        try {
          const dir = this.title
            .replace(/\s/g, "_")
            .replaceAll(":", "")
            .replaceAll("/", "-")
            .replaceAll("_-_", "-");
          const downloadDir = "download";
          const dirName = `${downloadDir}/${dir}/`;

          const content = [];
          data
            .filter(Boolean)
            .forEach(
              ({ season, episode, name, quality, link, qualityLinkList }) => {
                const fileName = [
                  FilmTypeEnum.FILM,
                  FilmTypeEnum.MULTFILMS,
                ].includes(this.filmType)
                  ? `${dir}-[${quality}]-[${translatorList.get(this.translator_id) || this.translator_id}].mp4`
                  : `${season}/s${season}-e${episode?.padStart(2, "0")}.mp4`;
                const path = `${downloadDir}/${dir}/${fileName}`;
                content.push({
                  path,
                  link,
                  name,
                  qualityLinkList,
                });
              },
            );
          if (!fs.existsSync(`${__dirname}/../${dirName}`)) {
            fs.mkdirSync(`${__dirname}/../${dirName}`, { recursive: true });
          }

          this.jsonFile = `${dirName}${this.seasonId || dir}.json`;
          fs.writeFileSync(
            `${__dirname}/../${this.jsonFile}`,
            JSON.stringify(content),
          );
          return `${this.jsonFile}`;
        } catch (e) {
          fs.writeFileSync(
            `${__dirname}/../download/error-log_${Date.now}.json`,
            JSON.stringify(data),
          );
        }
      }),
    );
  }

  upload() {
    console.log("UPLOAD JOB", this._selectedEpisodes);
    const requests = this.getLinks();
    try {
      const dirName = this.title.replace(/\s/g, "_").replace("/", "-");
      return combineLatest([...requests]).pipe(
        mergeMap((data) =>
          data.map(({ season, episode, subtitle, quality, link }) => {
            const fileName = [
              FilmTypeEnum.FILM,
              FilmTypeEnum.MULTFILMS,
            ].includes(this.filmType)
              ? `${dirName}-[${quality}]-[${translatorList.get(this.translator_id) || this.translator_id}].mp4`
              : `s${season}-e${episode}.mp4`;

            const result = new BehaviorSubject({
              fileName,
              progress: 0,
              status: "Start loading...",
            });

            const callback = () => {
              const subtitleFileNameList = [];
              (subtitle || []).forEach(({ lang, linkStr }) => {
                const subtitleDirName = `${dirName}/subtitle`;
                const subtitleFileName = `[${lang}]-${translatorList.get(this.translator_id) || this.translator_id}.vtt`;
                subtitleFileNameList.push(
                  `${subtitleDirName}/${subtitleFileName}`,
                );
                this.downloadFile(
                  linkStr,
                  `${__dirname}/download/${subtitleDirName}`,
                  subtitleFileName,
                );
              });
              const m3uManager = require(`${__dirname}/m3u-manager`);
              m3uManager.addStream(
                dirName,
                fileName,
                this.image,
                subtitleFileNameList,
              );
            };

            this.downloadFile(
              link,
              `${__dirname}/download/${dirName}`,
              fileName,
              callback,
              result,
            );

            return result;
          }),
        ),
        mergeAll(),
      );
    } catch (e) {
      console.log(e);
    }
  }

  downloadFile(url, dirName, fileName, cb, status$ = undefined) {
    const result =
      status$ ||
      new BehaviorSubject({
        fileName,
        progress: 0,
        status: "Start loading...",
      });
    const path = `${dirName}/${fileName}`;
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }

    http
      .get(url, (response) => {
        const code = response.statusCode ?? 0;
        const len = parseInt(response.headers["content-length"], 10);
        let cur = 0;
        if (code >= 400) {
          return new Error(response.statusMessage);
        }

        if (code > 300 && code < 400 && response.headers.location) {
          return this.downloadFile(
            response.headers.location,
            dirName,
            fileName,
            cb,
            status$,
          );
        }

        const file = fs.createWriteStream(path);
        response.pipe(file);
        response.on("data", (chunk) => {
          cur += chunk.length;
          const ceilProgress = Math.ceil((100.0 * cur) / len);

          if (result.value?.progress !== ceilProgress && ceilProgress !== 100) {
            result.next({
              fileName,
              progress: ceilProgress,
              status: "Progress",
            });
          }
        });
        file.on("finish", () => file.close(cb));
        response.on("end", () => {
          result.next({
            fileName,
            progress: result.value?.progress || 100,
            status: "Completed",
            link: `http://192.168.1.200/nodeJs/bot/download/${path}`,
          });
          result.complete();
        });
      })
      .on("error", (err) => {
        fs.unlink(path);
        console.log("error---", err);
        result.next({
          fileName,
          progress: null,
          status: `Error: ${err.message}`,
        });
        if (cb) {
          cb(err.message);
        }
      });
    return result;
  }

  parse() {
    console.log("PARSER JOB", this._selectedEpisodes);
  }

  get translatorKeyboard() {
    return {
      reply_markup: {
        inline_keyboard: [...translatorList].reduce(
          (keyboard, [callback_data, text]) => {
            keyboard.push([{ text, callback_data }]);
            return keyboard;
          },
          [],
        ),
      },
    };
  }

  get seasonKeyboard() {
    return {
      reply_markup: {
        inline_keyboard: [...this.episodeList.keys()].reduce(
          (keyboard, callback_data) => {
            keyboard.push([
              {
                text: `Season ${callback_data}`,
                callback_data,
              },
              {
                text: `Select full "${callback_data}" season`,
                callback_data: `full:${callback_data}`,
              },
            ]);
            return keyboard;
          },
          [],
        ),
      },
    };
  }

  get episodeListValues() {
    return [...this.episodeList.get(this.seasonId)].map(({ name }) => name);
  }

  get dividedEpisodeListValues() {
    const votes = this.episodeListValues;
    const result = [];
    if (votes.length === 1) {
      votes.push("do not select this!");
      return [votes];
    }

    if (votes.length === 10) {
      return [votes];
    }

    for (let i = 0; i < Math.ceil(votes.length / 9); i++) {
      const values = votes.slice(i * 9, i * 9 + 9);
      result.push(["Skip this selection", ...values]);
    }

    return result;
  }

  getTypeByName(name) {
    switch (name) {
      case "series":
        return FilmTypeEnum.SERIES;
      case "cartoons":
        return FilmTypeEnum.MULTFILMS;
      case "films":
        return FilmTypeEnum.FILM;
      case "animation":
        return FilmTypeEnum.ANIME;
      case "show":
        return FilmTypeEnum.TVSHOWS;
      default:
        return FilmTypeEnum.FILM;
    }
  }

  parseMetaTag(tag) {
    return this.html$(`meta[property="${tag}"]`).attr("content");
  }

  getFilmId() {
    return this.html$(".b-userset__fav_holder").attr("data-post_id") ?? null;
  }

  canGetSeasons() {
    const count = this.html$(
      "#simple-seasons-tabs .b-simple_season__item",
    ).length;

    if (count === 1) {
      this.season = 1;
    }

    return count;
  }

  getEpisodeList(htmlList) {
    const $ = cheerio.load(htmlList);

    $(".b-simple_episode__item, li[data-episode_id]").each((_, el) => {
      const $el = $(el);
      const dataId = $el.attr("data-id");
      const seasonId = $el.attr("data-season_id");
      const episodeId = $el.attr("data-episode_id");
      const name = $el.text().trim();

      if (!seasonId || !episodeId) {
        return;
      }

      if (!this.episodeList.has(seasonId)) {
        this.episodeList.set(seasonId, [{ episodeId, name, dataId }]);
      } else {
        this.episodeList.get(seasonId).push({ episodeId, name, dataId });
      }
    });

    return this.episodeList;
  }

  decodeUrl(str) {
    if (!str || !str.startsWith("#h")) {
      return str;
    }

    let replace = str.replace("#h", "");
    let i = 0;
    while (i < 20 && replace.includes("//_//")) {
      const indexOf = replace.indexOf("//_//");
      if (indexOf > -1) {
        replace = replace.replace(replace.substring(indexOf, indexOf + 21), "");
      }

      i++;
    }

    // Return Buffer.from(replace, 'base64').toString('binary');
    try {
      const decoded = Buffer.from(replace, "base64").toString("binary");
      return this.sanitizeString(decoded);
    } catch (error) {
      console.error("Помилка декодування:", error);
      return this.sanitizeString(replace);
    }
  }

  sanitizeString(str) {
    if (!str) {
      return str;
    }

    return str
      .replace(/[\x00-\x1F\x7F]/g, "") // Binary control chars
      .replace(/\\t/g, "") // Literal \t
      .replace(/\\u00[0-1][0-9A-Fa-f]/g, "") // \u0000-\u001F
      .replace(/\$\$@/g, "")
      .replace(/[^\x20-\x7E\u0080-\uFFFF]/g, "");
  }

  parseQualityLinkMap(links) {
    const linksArr = (links || "").split(",");
    const regex = /\[(.+)?](.+)?/;
    const result = [];
    linksArr.forEach((link) => {
      if (link && link.includes("mp4")) {
        const [_, quality, linkStr] = link.match(regex) || [];
        let links = (linkStr || "")
          .split(" or ")
          .map((link) => String.raw`${link}`)
          .filter((link) => !link.includes("manifest.m3u8"));
        if (links.length === 1) {
          links = (linkStr || "")
            .split(" ")
            .filter((link) => link.includes("mp4"));
        }

        const loadLink = links.find(
          (link) => !link.includes("m3u8") && !/\\/.test(link),
        );
        result.push({ quality, links, loadLink });
      }
    });
    return result;
  }

  parseSubtitle(subtitle) {
    const subtitleArr = (subtitle || "").split(",");
    const regex = /\[(.+)?](.+)?/;
    const result = [];
    subtitleArr.forEach((item) => {
      if (item) {
        const [_, lang, linkStr] = item.match(regex) || [];
        result.push({ lang, linkStr });
      }
    });
    return result;
  }

  getEpisodes() {
    if (this.episodeList.size) {
      return of(this.episodeList);
    }

    return from(
      this.loadEpisodes({
        id: this.filmId,
        translator_id: this.translator_id,
        action: "get_episodes",
      }),
    ).pipe(map((data) => this.getEpisodeList(data.episodes)));
  }

  getNextStep(currentStep) {
    if (currentStep === stepEnum.WORKER_GET_TRANSLATOR) {
      if (this.canGetSeasons() >= 2 && !this.seasonId) {
        return stepEnum.WORKER_GET_SEASON;
      }

      if (this.seasonId && !this.episodeList.size) {
        return stepEnum.WORKER_GET_EPISODES;
      }

      return !this.episodeList.size
        ? stepEnum.WORKER_PARSE_OR_UPLOAD
        : stepEnum.WORKER_GET_SEASON;
    }
    // If (this.filmType === FilmTypeEnum.MULTFILMS) {
    //     return [this.getMovieUrl()]
    // }
    // return this.filmType === FilmTypeEnum.FILM ? [this.getMovieUrl()] : this.getEpisodesUrl();
  }

  getEpisodesUrl() {
    return this._selectedEpisodes.map(({ episodeId, name }, index) => {
      const promise = new Promise((resolve) =>
        setTimeout(resolve, (1 + index) * 1000),
      )
        .then(() =>
          this.loadEpisodes({
            id: this.filmId,
            translator_id: this.translator_id,
            season: this.seasonId,
            episode: episodeId,
            action: "get_stream",
          }),
        )
        .then((data) => {
          const urls = this.decodeUrl(data.url);
          const qualityLinkMap = this.parseQualityLinkMap(urls);
          let latestQuality = qualityLinkMap[qualityLinkMap.length - 1];
          if (latestQuality && !latestQuality.loadLink) {
            latestQuality = qualityLinkMap[qualityLinkMap.length - 2];
          }

          this._selectedEpisodes = this._selectedEpisodes.filter(
            (se) => se.episodeId !== episodeId,
          );

          return {
            season: this.seasonId,
            episode: episodeId,
            quality: latestQuality?.quality,
            link: latestQuality?.loadLink,
            qualityLinkList: [...qualityLinkMap].reverse(),
            name,
          };
        });
      return from(promise).pipe(
        retry(1),
        catchError((error) => {
          console.error(`Error loading episode ${episodeId}:`, error);
          return of(null);
        }),
      );
    });
  }

  getMovieUrl() {
    return from(
      this.loadEpisodes({
        id: this.filmId,
        translator_id: this.translator_id,
        action: "get_movie",
      }),
    ).pipe(
      map((data) => {
        if (!data.success) {
          console.log("Failed to get movie", data);
          return throwError("Failed to get movie");
        }

        const urls = this.decodeUrl(data.url);
        const subtitle = this.parseSubtitle(data.subtitle);
        const qualityLinkMap = this.parseQualityLinkMap(urls);
        let latestQuality = qualityLinkMap[qualityLinkMap.length - 1];
        if (!latestQuality?.loadLink) {
          latestQuality = qualityLinkMap[qualityLinkMap.length - 2];
        }

        return {
          subtitle,
          name: this.title,
          quality: latestQuality?.quality,
          link: latestQuality?.loadLink,
          qualityLinkList: [...qualityLinkMap].reverse(),
        };
      }),
    );
  }

  getTranslatorList() {
    const result = new Map();
    const items = this.html$(".b-translator__item")
      .map((_, el) => ({
        translate: this.html$(el).attr("title"),
        translatorId: this.html$(el).data("translator_id"),
        subTitle: this.html$(el).text().trim(),
      }))
      .get();
    items.forEach(({ translatorId, translate }) => {
      result.set(translatorId, translate);
    });
    return result;
  }

  getHtml() {
    return defer(() => {
      if (!this.isAuthenticated) {
        return from(this.authenticate()).pipe(
          switchMap(() => this.fetchPageWithAuth()),
        );
      }

      return this.fetchPageWithAuth();
    });
  }

  fetchPageWithAuth() {
    return defer(() =>
      fetch(this.pageLink, {
        referrer: this.pageLink,
        referrerPolicy: "no-referrer-when-downgrade",
        headers: {
          Cookie: this.getCookieString(),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.95 Safari/537.36",
          Referer: `https://${this.domain}/`,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        },
      }),
    ).pipe(
      switchMap((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }

        const setCookies = response.headers.raw()["set-cookie"] || [];
        this.parseCookies(setCookies);

        return from(response.text());
      }),
      tap((htmlData) => {
        this.html = htmlData;
        this.html$ = cheerio.load(htmlData);
        this.filmId = this.getFilmId();
        this.isBlocked = Boolean(this.html$(".b-player__restricted").length);
      }),
      catchError((error) => {
        console.error("Error fetching HTML:", error);
        return of(null);
      }),
    );
  }

  loadPage() {
    return this.getHtml().pipe(
      map(() => {
        translatorList = this.getTranslatorList();
        this._selectedEpisodes = [];
        this.title = this.parseMetaTag("og:title");
        this.image = this.parseMetaTag("og:image");

        if (!translatorList.size) {
          let index = this.html.indexOf("initCDNMoviesEvents");
          let regex = /initCDNMoviesEvents\((\d+)?, (\d+)?, (\d+)?,/;
          if (index === -1) {
            index = this.html.indexOf("initCDNSeriesEvents");
            regex = /initCDNSeriesEvents\((\d+)?, (\d+)?, (\d+)?,/;
          }

          const subString = this.html.substring(
            index,
            this.html.indexOf('{"id"', index),
          );
          const [_, filmId, translator_id, seasonId] =
            subString.match(regex) || [];
          this.filmId = filmId;
          this.translatorId = this.translator_id || translator_id;
        }

        if (!this.translator_id) {
          return stepEnum.WORKER_GET_TRANSLATOR;
        }

        if (this.filmType === FilmTypeEnum.FILM) {
          return stepEnum.WORKER_PARSE_OR_UPLOAD;
        }

        if (!this.seasonId) {
          return stepEnum.WORKER_GET_SEASON;
        }

        return stepEnum.WORKER_GET_EPISODES;
      }),
    );
  }

  async loadEpisodes(body, headers = {}) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    return fetch(
      `https://${this.domain}/ajax/get_cdn_series/?t=${Date.now()}`,
      {
        method: "post",
        body: new URLSearchParams(body),
        headers: {
          Host: this.domain,
          Cookie: this.getCookieString(),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.95 Safari/537.36",
          Origin: `https://${this.domain}`,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: this.pageLink,
          ...headers,
        },
      },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return response.json();
      })
      .catch((error) => {
        throw new Error(
          `Failed to load episode: ${error.message} | Request body: ${JSON.stringify(body)}`,
        );
      });
  }
}

module.exports = Worker;

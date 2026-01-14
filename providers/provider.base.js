const fetch = require("node-fetch");
const { from } = require("rxjs");
const fs = require("fs");
const cheerio = require("cheerio");

class ProviderBase {
  constructor(link) {
    this.pageLink = link;
    this.html = "";
    this.title = "";
    this.fileName = "";
    this.href = "";
    this.domain = this.extractDomain(link);
    this.episodeList = new Map();
  }

  get availableSeasons() {
    return [...this.episodeList.keys()];
  }

  extractDomain(link) {
    const regex = /^https?:\/\/([^\/]+)\//;
    const match = (link || "").match(regex);
    return match ? match[1] : null;
  }

  // Generic meta tag parser: tries cheerio if html looks like markup, otherwise regex
  parseMetaTag(tag) {
    try {
      if (this.html && this.html.includes("<")) {
        const $ = cheerio.load(this.html);
        return $(`meta[property="${tag}"]`).attr("content");
      }
    } catch (e) {
      // fallthrough to regex
    }

    const content =
      (this.html || "").match(
        new RegExp(`<meta property="${tag}" content="([^\"]*)"`),
      ) || [];
    return content[1];
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
        Referer: link,
      },
      referrerPolicy: "no-referrer-when-downgrade",
    }).then((response) => {
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`);
      return response;
    });
  }

  getHtml(link) {
    return from(this._loadPage(link).then((r) => r.text()));
  }

  getJson(link) {
    return from(this._loadPage(link).then((r) => r.json()));
  }

  _writeToPlaylist(data) {
    const path = `download/m3u/parser${data.type === "lq" ? ".lq" : ""}.m3u`;
    fs.appendFileSync(path, `#EXTINF:0,${data.title}\n`);
    fs.appendFileSync(path, `${data.playlistLink}\n`);
  }

  _decodeUrlFromText(href) {
    try {
      return [
        ...decodeURIComponent(href || "").matchAll(/file=(http.+?m3u8)?\?/g),
      ];
    } catch (e) {
      return [];
    }
  }

  _prepareResult() {
    const addonLink = "http://192.168.1.200/m3u/tv/";
    return this._decodeUrlFromText(this.href).map((itm) => {
      const link = itm[1];
      const type = (link.match(/(\w*)\.mp4/) || [])[1] || "hd";
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

  getLinks() {
    // SHOULD be implemented in subclasses if needed. Return empty array by default.
    return [];
  }

  setSelectedEpisodesBySesone(val) {
    this._selectedEpisodes = val;
  }
}

module.exports = ProviderBase;

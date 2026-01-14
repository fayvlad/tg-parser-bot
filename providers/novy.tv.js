const ProviderBase = require(`${__dirname}/provider.base`);
const stepEnum = require(`${__dirname}/../step-enum-util`);
const { map, switchMap, of } = require("rxjs");
const cheerio = require("cheerio");

class Worker extends ProviderBase {
  constructor(link) {
    super(link);
    this.pageLink = link;
    this.fileHash = null; // extracted hash
    this.quality = ""; // extracted hash
  }

  get parseOrUploadKeyboard() {
    return [[{ text: "Get link", callback_data: stepEnum.WORKER_GET_LINK }]];
  }
  // loadPage возвращает Observable, как у других провайдеров
  loadPage() {
    return this.getHtml(this.pageLink).pipe(
      switchMap((html) => {
        this.html = html || "";
        const $ = cheerio.load(this.html);
        const iframe = $(".adaptive-iframe-wrapper iframe").attr("src");

        if (!iframe) {
          throw new Error("adaptive iframe not found");
        }

        // извлекаем параметр hash из URL iframe src
        let hash;
        try {
          const url = new URL(iframe);
          hash = url.searchParams.get("hash");
          if (!hash) {
            throw new Error("hash param not found in iframe src");
          }
        } catch (err) {
          throw new Error(`failed to parse iframe src: ${err.message}`);
        }

        this.fileHash = hash;
        this.hashId = [];
        this.hashId[1] = hash;

        const apiUrl = `https://vcms-api2.starlight.digital/player-api/${hash}?referer=https://extremelove.novy.tv/&lang=ua`;

        return this.getJson(apiUrl).pipe(
          map((apiJson) => {
            // expected shape: { result: { video: [ { mediaHlsNoAdv: '...' } ] } } or video directly
            const video = apiJson?.result?.video || apiJson?.video || [];
            const first = video[0] || null;
            const media =
              first?.mediaHlsNoAdv || first?.media?.at(0)?.url || null;
            if (!media) {
              throw new Error("mediaHlsNoAdv not found in API response");
            }
            this.href = media;
            // try to set title/fileName if available
            this.fileName = first?.program || this.fileName;
            this.title =
              `${first?.projectName}-${first?.seasonName}-${first?.releaseName}` ||
              this.title ||
              this.fileName;

            this.quality = first?.media?.at(0)?.quality || "auto";
            return stepEnum.WORKER_PARSE_OR_UPLOAD;
          }),
        );
      }),
    );
  }

  // минимальный интерфейс: возвращаем пустой список ссылок (или можно расширить)
  getLinks() {
    if (!this.href) return [];
    return [
      of({
        link: this.href,
        name: this.title || this.fileHash,
        quality: this.quality,
        qualityLinkList: [],
      }),
    ];
  }
}

module.exports = Worker;

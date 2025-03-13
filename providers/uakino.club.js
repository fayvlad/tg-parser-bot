const fetch = require("node-fetch");
const stepEnum = require(`${__dirname}/../step-enum-util`);
const cp = require("child_process");
const {from, switchMap, tap, map, of, forkJoin, take, iif} = require("rxjs");
const fs = require("fs");
const playerLink = 'https://fayvlad.github.io/player/?source=';

const FilmTypeEnum = {
    FILM: 0, SERIES: 1, ANIME: 2, MULTFILMS: 3, SingleMULTFILM: 3.1, TVSHOWS: 4
};

class Worker {
    constructor(link) {
        console.log('Worker constructor - uakino.club');
        this.html = '';
        this.title = this.extractTitle(link);
        this.fileName = '';
        this.href = '';
        this.seasonId = 'seasonId';
        this.hashId = [];
        this.filmType = this.getTypeByName(link);
        this.episodeList = new Map();
        this.translatorList = new Map();
        this.translatorId = null;
        this.pageLink = link;
        this.domain = this.extractDomain(link);
        this._selectedEpisodes = [];
        this.id = this.extractId(link);
        this.apiUrl = `https://${this.domain}/engine/ajax/playlists.php?news_id=${this.id}&xfield=playlist&time=${Date.now()}`;
    }

    extractTitle(link) {
        console.log('extractTitle', link);
        return /(\d+)-(.*)\.html/gs.exec(link.split('/').at(-1))[2] || 'unknown';
    }

    extractDomain(link) {
        const regex = /^https?:\/\/([^\/]+)\//;
        const match = link.match(regex);
        return match ? match[1] : null;
    }

    extractId(link) {
        return /(\d+)/gs.exec(link.split('/').at(-1))[0] || null;
    }

    get parseOrUploadKeyboard() {
        return [[{text: `Parse (add to playlist)`, callback_data: stepEnum.WORKER_PARSE}, {
            text: `Get link`,
            callback_data: stepEnum.WORKER_GET_LINK
        },]];
    }

    get episodeListValues() {
        return [...this.episodeList.values()]
            .filter(item => item.translatorId === this.translatorId)
            .map(({subTitle}) => subTitle);
    }

    get dividedEpisodeListValues() {
        const votes = this.episodeListValues;
        const result = [];

        if (votes.length === 1) {
            votes.push('do not select this!');
            return votes;
        }
        for (let i = 0; i < Math.ceil(votes.length / 9); i++) {
            const values = votes.slice((i * 9), (i * 9) + 9);
            result.push(['Skip this selection', ...values]);
        }

        return result;
    }

    get translatorKeyboard() {
        return {
            reply_markup: {
                inline_keyboard: [...this.translatorList].reduce((keyboard, [callback_data, text]) => {
                    keyboard.push([{text, callback_data}]);
                    return keyboard;
                }, [])
            }
        };
    }

    get seasonKeyboard() {
        return {
            reply_markup: {
                inline_keyboard: [...this.episodeList.keys()].reduce((keyboard, callback_data) => {
                    keyboard.push([{
                        text: `Season ${callback_data}`,
                        callback_data
                    }, {text: `Select full "${callback_data}" season`, callback_data: `full:${callback_data}`}]);
                    return keyboard;
                }, [])
            }
        };
    }

    set selectedEpisodes(val) {
        this._selectedEpisodes = [...this.episodeList.values()]
            .filter(item => val.includes(item.subTitle) && item.translatorId === this.translatorId);
    }

    upload() {
        // Implementation of upload method
    }

    parse() {
        const path = `/mnt/video/playlists/m3u/uakino.m3u`;

        forkJoin([...this.getLinks()]).pipe(tap((links) => {
            links.forEach((link, name) => {
                fs.appendFileSync(path, `#EXTINF:0,${name}\n`);
                fs.appendFileSync(path, `${link}\n`);
            });
        }), take(1)).subscribe();
    }

    getNextStep(currentStep) {
        if (currentStep === stepEnum.WORKER_GET_TRANSLATOR) {
            if (this.filmType === FilmTypeEnum.SERIES || (this.filmType === FilmTypeEnum.MULTFILMS && this.episodeList.size)) {
                return stepEnum.WORKER_GET_EPISODES;
            }
            return stepEnum.WORKER_GET_EPISODES;
            // return stepEnum.WORKER_GET_SEASON;
        }
    }

    _writeToPlaylist(data) {
        const path = `/mnt/video/playlists/m3u/parser${data.type === 'lq' ? '.lq' : ''}.m3u`;

        fs.appendFileSync(path, `#EXTINF:0,${data.title}\n`);
        fs.appendFileSync(path, `${data.playlistLink}\n`);
    }

    _loadPage(link) {
        return fetch(link, {
            referrer: link, headers: {
                'accept': '*/*',
                "x-requested-with": "XMLHttpRequest",
                "accept-language": "uk",
                "cache-control": "no-cache",
                "pragma": "no-cache",
                "priority": "u=1, i",
                "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "Referer": link,
                "Referrer-Policy": "strict-origin-when-cross-origin"
            }, referrerPolicy: 'no-referrer-when-downgrade',
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response;
            })
            .catch(error => {
                console.log(error)
                throw new Error(`Failed to load episode: ${error.message} | Request body: ${JSON.stringify(error)}`);
            });
    }

    _decodeUrlFromText(href) {
        return [...decodeURIComponent(href).matchAll(/file=(http.+?m3u8)?\?/g)];
    }

    _prepareResult() {
        const addonLink = 'http://192.168.1.200/m3u/tv/';
        return this._decodeUrlFromText(this.href).map(itm => {
            const link = itm[1];
            const type = link.match(/(\w*)\.mp4/)[1];
            const name = `${this.fileName}.${type}.m3u8`;

            return {link, name, type, title: this.title, playlistLink: `${addonLink}${name}`};
        });
    }

    parse() {
        const download = async (uri, filename) => cp.execSync(`curl -k -o ${filename}  '${uri}'`);
        return this._prepareResult().map(async film => {
            this._writeToPlaylist(film);
            await download(film.link, `/mnt/video/playlists/m3u/tv/${film.name}`);
        });
    }

    getLinks() {
        const m3uLink = (item) => this.getHtml(item.link).pipe(map(html => {
            const m3uUrl = (/file:"(.+?)"/gs.exec(html))[1] || 'error';
            return {
                link: `${playerLink}${encodeURIComponent(m3uUrl)}`,
                name: `${item.subTitle}`,
                quality: (/default_quality:"(.+?)"/gs.exec(html))[1] || '__'
            };
        }));
        return this._selectedEpisodes.map(item => m3uLink(item));
    }

    getHtml(link) {
        return from(this._loadPage(link).then(data => data.text()));
    }

    getJson(link) {
        return from(this._loadPage(link).then(data => data.json()));
    }

    setSelectedEpisodesBySesone(val) {
        this._selectedEpisodes = [...this.episodeList.values()];
    }

    loadPage() {
        const multiSeries = this.getJson(this.apiUrl).pipe(tap(data => {
            this.html = data.response;
            this.title = this.parseMetaTag("og:title") || this.title;
        }), map(() => {
            this.getTranslatorList();
            if (this.translatorList.size === 1) {
                this.translatorId = [...this.translatorList.keys()][0];
                return stepEnum.WORKER_GET_EPISODES;
            }
            return stepEnum.WORKER_GET_TRANSLATOR;
        }));

        const singleSerie = of(false).pipe(map(() => {
            const link = this.parseLinkTag('video') || (/iframe.+?src="(.+?)?"/gs.exec(this.html))[1] || 'error';
            const subTitle = this.parseMetaTag("og:title") || this.title;
            this._selectedEpisodes.push({link, subTitle});
            return stepEnum.WORKER_PARSE_OR_UPLOAD;
        }));

        let isMultiSeries = false;
        return this.getHtml(this.pageLink).pipe(tap(html => {
            this.html = html;
            this.title = this.parseMetaTag("og:title") || this.title;
            isMultiSeries = this.html.includes('playlists-ajax') && this.html.includes('playlists-items');

            // console.log('isMultiSeries', isMultiSeries);
        }), switchMap(() => iif(() => isMultiSeries, multiSeries, singleSerie)));
    }

    getEpisodes() {
        return of(this.episodeList);
    }

    getTranslatorList() {
        const listBlockHtml = (/class="playlists-videos".+"playlists-items">.+<ul>(.*?)<\/ul>/gs.exec(this.html));
        // const listBlockHtml = (/<div class="playlists-items">.+<ul>(.*?)<\/ul>.+<\/div>/gs.exec(this.html));
        const regex = /<li data-file="(.*?)" data-id="(.*?)" data-voice="(.*?)">(.*?)<\/li>/gs;
        let list = [];

        if (listBlockHtml) {
            while ((list = regex.exec(listBlockHtml[1])) !== null) {
                let [, link, translatorId, translate, subTitle] = list;
                if (link.startsWith('//')) {
                    link = 'https:' + link;
                }
                this.episodeList.set(link, {translatorId, translate, subTitle, link});
                this.translatorList.set(translatorId, translate);
            }
        }
    }

    getTypeByName(link) {
        const name = link.split('/')[3];
        const type = link.split('/')[4];
        switch (name) {
            case 'seriesss':
                return FilmTypeEnum.SERIES;
            case 'filmy':
                return FilmTypeEnum.FILM;
            case 'cartoon':
                return type === 'features' ? FilmTypeEnum.SingleMULTFILM : FilmTypeEnum.MULTFILMS;
            default:
                return FilmTypeEnum.FILM;
        }
    }

    parseMetaTag(tag) {
        const content = this.html.match(new RegExp(`<meta property="${tag}" content="([^"]*)"`)) || [];
        return content[1];
    }

    parseLinkTag(tag) {
        const content = this.html.match(new RegExp(`<link itemprop="${tag}" value="(.*?)"`)) || [];
        return content[1];
    }
}

module.exports = Worker;
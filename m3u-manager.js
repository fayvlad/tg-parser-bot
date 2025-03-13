// const serverName = '192.168.1.200'
const serverName = 'http://vfay.duckdns.org'

module.exports.addStream = (filmDirName, fileName, image, subtitleFileNameList) => {
    const m3uStart = '#EXTM3U';
    const subtitles = subtitleFileNameList.length ? `subtitles="${subtitleFileNameList[1]}"` : ''
    const filmM3u = `#EXTINF:-1 tvg-name="${fileName}" tvg-logo="${image} ${subtitles}, ${fileName}"`
    const address = `${serverName}/nodeJs/tv_bot/download`
    console.log(`${m3uStart}\r\n${filmM3u} \r\n ${address}/${filmDirName}\r\n\r\n`);
};
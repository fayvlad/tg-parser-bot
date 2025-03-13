module.exports.parse = (link) => {
    const regex = /https?:\/\/(www\.)?(.+?)?\/.*/;
    const [, , filename] = link.match(regex) || [];

    const rezkaMirrors = ['rezka.ag', 'rezka.cc', 'rezka.co', 'rezka.me', 'rezka.net', 'rezka.tv', 'rezka.ws', 'rezka.xyz', 'rezka.ua.tv', 'rezka-ua.tv', 'hdrezka.ag'];
    const uakinoMirrors = ['uakino.club', 'uakino.me'];
    const uaserialMirrors = ['uaserial.club', 'uaserial.tv', 'uaserials.com', 'uaserials.net'];
    if (rezkaMirrors.includes(filename)) {
        return 'rezka.ag'
    }

    if (uakinoMirrors.includes(filename)) {
        return 'uakino.club'
    }
    if (uaserialMirrors.includes(filename)) {
        return 'uakino.club'
    }
    return filename || '';
};
const provider = 'uaserials.pro.js';
const link = 'https://uaserials.pro/1091-novobranec.html'; // Link to the page
// const link = 'https://uaserials.pro/2-sonik-3.html'; // Link to the page
// const link = 'https://uaserials.pro/1693-odyn-vdoma.html'; // Link to the page
const Worker = require(`./providers/${provider}`);
const stepEnum = {
    START: 0,
    GET_WORKER: 1,
    WORKER_JOB: 2,
    WORKER_GET_TRANSLATOR: 2.1,
    WORKER_GET_SEASON: 2.2,
    WORKER_GET_EPISODES: 2.3,
    WORKER_PARSE_OR_UPLOAD: 3,
    WORKER_GET_FULL_LINK: 3.4,
    WORKER_GET_LINK: 3.3,
    WORKER_UPLOAD: 3.2,
    WORKER_PARSE: 3.1,
    WORKER_TO_FILE: 4,
};
const steps = [stepEnum.WORKER_JOB]
const testing =  new Worker(link, stepEnum);
testing.loadPage().subscribe();

const fs = require('fs').promises;
const path = require('path');

const directory = './download/';

function padNumber(num) {
    return String(num).padStart(2, '0');
}

async function renameFiles() {
    try {
        const files = await fs.readdir(directory);

        for (const file of files) {
            const match = file.match(/^s(\d+)-e(\d+)\.mp4$/);
            if (match) {
                const [, season, episode] = match;
                const paddedSeason = padNumber(season);   // Додаємо нулі до сезону
                const paddedEpisode = padNumber(episode); // Додаємо нулі до епізоду
                const newFileName = `s${season}-e${paddedEpisode}.mp4`;

                if (file !== newFileName) {
                    const oldPath = path.join(directory, file);
                    const newPath = path.join(directory, newFileName);

                    await fs.rename(oldPath, newPath);
                    console.log(`Перейменовано: ${file} → ${newFileName}`);
                } else {
                    console.log(`Пропущено: ${file} (вже у правильному форматі)`);
                }
            }
        }
        console.log('Перейменування завершено!');
    } catch (err) {
        console.error('Помилка:', err);
    }
}

renameFiles();
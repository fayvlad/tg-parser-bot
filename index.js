require("dotenv").config();
const urlParser = require(`${__dirname}/url-parser`);
const stepEnum = require(`${__dirname}/step-enum-util`);
const { spawn } = require("child_process");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const {
  tap,
  switchMap,
  take,
  of,
  from,
  map,
  sampleTime,
  filter,
  forkJoin,
  catchError,
  throwError,
} = require("rxjs");
const { EventEmitter } = require("events");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN not found in .env file");
}

const fileMap = new Map();
const downloadsDir = path.join(__dirname, "download");

const bot = new TelegramBot(token, { polling: true });
bot.setMyCommands([
  { command: "start", description: "Command for running the process" },
  { command: "cancel", description: "Command for stop the process" },
  { command: "dir", description: "Command for working with files" },
  { command: "help", description: "Command for stop the process" },
]);

const StepRepository = new Map();
const polls = new Map();
let selectedSeries = [];
bot.on("polling_error", console.log);
bot.onText(/\/help/, (msg) => {
  try {
    bot.sendMessage(
      msg.chat.id,
      "supported links: \r rezka.ag \r uakino.club \r uaserials.pro \r teleportal.ua",
    );
  } catch (e) {
    handleError(e, msg.chat.id);
  }
});
bot.onText(/\/start/, (msg) => {
  try {
    _start(msg);
    bot.sendMessage(msg.chat.id, "Insert your link");
  } catch (e) {
    handleError(e, msg.chat.id);
  }
});

function generateShortId() {
  return Math.random().toString(36).slice(2, 10); // 8 символів
}

async function parseDir(msg, match, additionalMessage = "") {
  const chatId = msg.chat.id;
  const subPath = match[1] || "";
  const currentDir = path.join(downloadsDir, subPath);
  const currentDirTxt = currentDir.replace(downloadsDir, "download");

  try {
    const stats = await fs.promises.stat(currentDir);
    if (!stats.isDirectory()) {
      bot.sendMessage(chatId, `🚫 "${currentDirTxt}" не є директорією!`);
      return;
    }

    let items = await fs.promises.readdir(currentDir, { withFileTypes: true });
    items = items.filter((item) => !item.name.includes("DS_Store"));
    let message = [additionalMessage, `💻 "${currentDirTxt}":\n`].join(
      "\r\n\n",
    );
    const keyboard = { inline_keyboard: [] };
    fileMap.clear();

    if (subPath && subPath !== ".") {
      const parentPath = path.dirname(subPath) || "";
      const backId = generateShortId();
      fileMap.set(backId, parentPath);
      keyboard.inline_keyboard.push([
        {
          text: "↩️ Назад",
          callback_data: `cd:${backId}`,
        },
      ]);
    }

    if (items.length === 0) {
      message = "📂 Папка порожня.";
    }

    for (const item of items) {
      const itemPath = path.join(subPath, item.name);
      const fullPath = path.join(currentDir, item.name);
      const isDir = item.isDirectory();
      const label = `${isDir ? "📁" : "📄"} ${item.name}\n`;

      const itemId = generateShortId();
      fileMap.set(itemId, itemPath);

      const buttons = [];
      if (isDir) {
        buttons.push({
          text: label,
          callback_data: `cd:${itemId}`,
        });
        buttons.push({
          text: "🗑",
          callback_data: `rm:${itemId}`,
        });
      } else {
        buttons.push({
          text: `${label} 🗑`,
          callback_data: `rm:${itemId}`,
        });
      }

      keyboard.inline_keyboard.push(buttons);
    }

    bot.sendMessage(chatId, message, { reply_markup: keyboard });
  } catch (err) {
    bot.sendMessage(chatId, "🚫 Помилка при читанні папки!");
    console.error(err);
  }
}

bot.onText(/\/dir(?:\s+(.+))?/, (msg, match) => parseDir(msg, match));

function _start(msg) {
  StepRepository.set(msg.chat.id, {
    date: msg.date,
    user: msg.from.id,
    step: new EventEmitter(),
    chatId: msg.chat.id,
    currentStep: stepEnum.START,
    progressMessageId: new Map(),
    messageId: 0,
    parsedLinks: [],
  });
  const { step } = StepRepository.get(msg.chat.id);
  prepareListeners(step);
}

bot.onText(/\/cancel/, (msg) => {
  try {
    const { step } = StepRepository.get(msg.chat.id);
    step.removeAllListeners();
    StepRepository.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, "To start use command /start");
  } catch (e) {
    handleError(e, msg.chat.id);
  }
});

bot.on("message", (msg) => {
  try {
    if (
      msg.entities &&
      msg.entities.some(({ type }) => type === "bot_command")
    ) {
      return;
    }

    const isNewUrl =
      msg.entities && msg.entities.some(({ type }) => type === "url");

    if (!StepRepository.has(msg.chat.id) && !isNewUrl) {
      bot.sendMessage(msg.chat.id, "To start use command /start");
      return;
    }

    let session = StepRepository.get(msg.chat.id);
    if (isNewUrl && (!session || session?.currentStep !== stepEnum.START)) {
      StepRepository.delete(msg.chat.id);
      _start(msg);
    }

    session = StepRepository.get(msg.chat.id);
    if (session.currentStep === stepEnum.START) {
      session.step.emit(stepEnum.GET_WORKER, session, msg.text);
    }
  } catch (e) {
    handleError(e, msg.chat.id);
  }
});

bot.on("callback_query", async (callbackQuery) => {
  const { data } = callbackQuery;
  const msg = callbackQuery.message;
  const [action, targetId] = data.split(":");
  const targetPath = fileMap.get(targetId);

  try {
    if (action === "cd") {
      bot.deleteMessage(msg.chat.id, msg.message_id);
      parseDir(msg, ["", targetPath === "." ? "" : targetPath]);
      return;
    }

    if (action === "rm") {
      const fullPath = path.join(downloadsDir, targetPath);
      const stats = await fs.promises.stat(fullPath);
      let additionalMessage = "";
      bot.deleteMessage(msg.chat.id, msg.message_id);
      if (stats.isDirectory()) {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        additionalMessage = `📁 Директорію "${targetPath}" видалено!`;
      } else {
        await fs.promises.unlink(fullPath);
        additionalMessage = `📄 Файл "${targetPath}" видалено!`;
      }

      const parentDir = path.dirname(targetPath) || "";
      parseDir(msg, ["", parentDir], additionalMessage);
      return;
    }

    if (data === "skip") {
      bot.answerCallbackQuery(callbackQuery.id, {
        text: "Ну не тикай на цю кнопку!",
      });
      return;
    }

    if (!StepRepository.has(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, "To start use command /start");
      return;
    }

    const session = StepRepository.get(msg.chat.id);
    handleCallbackQuery(session, data, msg);
  } catch (e) {
    handleError(e, msg.chat.id);
  }
});

bot.on("poll", (callbackQuery) => {
  const { chatId, messageId } = polls.get(callbackQuery.id);
  try {
    selectedSeries.push(
      ...callbackQuery.options.filter(
        (item) =>
          Boolean(item.voter_count) &&
          !["Skip this selection", "do not select this!"].includes(item.text),
      ),
    );
    bot.deleteMessage(chatId, messageId);
    polls.delete(callbackQuery.id);
    handlePollCompletion(chatId);
  } catch (e) {
    handleError(e, chatId);
  }
});

const handleCallbackQuery = (session, data, msg) => {
  if (session.currentStep !== stepEnum.WORKER_GET_EPISODES) {
    const selectedItem = msg.reply_markup.inline_keyboard
      .flat()
      .find((item) => item.callback_data === data);
    bot.deleteMessage(msg.chat.id, msg.message_id);
    bot.sendMessage(
      msg.chat.id,
      `Your chose is: "${selectedItem.text}" \r\nwaiting...`,
    );
  }

  switch (session.currentStep) {
    case stepEnum.WORKER_GET_TRANSLATOR:
      session.worker.translatorId = data;
      session.step.emit(
        session.worker.getNextStep(session.currentStep),
        session,
      );
      break;
    case stepEnum.WORKER_GET_SEASON:
      session.step.emit(stepEnum.WORKER_GET_EPISODES, session, data);
      break;
    case stepEnum.WORKER_TO_FILE:
      session.step.emit(data, session);
      break;
    case stepEnum.WORKER_PARSE_OR_UPLOAD:
    case stepEnum.WORKER_GET_LINK:
      session.step.emit(data, session);
      break;
  }
};

const handlePollCompletion = async (chatId) => {
  const pollsInChatCount = [...polls.values()].filter(
    (item) => item.chatId === chatId,
  );
  if (!pollsInChatCount.length && !selectedSeries.length) {
    bot.sendMessage(chatId, "Try again. Select min one item");
  }

  if (!pollsInChatCount.length && selectedSeries.length) {
    bot.sendMessage(
      chatId,
      `Your chose is: \r\n${selectedSeries.map(({ text }) => text).join("\r\n")}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const session = StepRepository.get(chatId);
    session.worker.selectedEpisodes = selectedSeries.map(({ text }) => text);
    selectedSeries = [];
    const step = session.worker.getNextStep(session.currentStep);
    session.step.emit(step || stepEnum.WORKER_PARSE_OR_UPLOAD, session);
  }
};

const handleError = (error, chatId) => {
  console.log(error);
  bot.sendMessage(chatId, `ERROR: ${error}`);
};

const selectSeries = (session, chatId) => {
  const pollPromises = session.worker.dividedEpisodeListValues.map((list) =>
    bot
      .sendPoll(chatId, "Select series", list, {
        allows_multiple_answers: true,
        total_voter_count: 1,
      })
      .then((resp) => {
        polls.set(resp.poll.id, {
          messageId: resp.message_id,
          chatId: resp.chat.id,
        });
      }),
  );
  Promise.all(pollPromises);
};

const prepareListeners = (step) => {
  step.on(stepEnum.WORKER_GET_LINK, (session) => {
    session.currentStep = stepEnum.WORKER_GET_LINK;
    forkJoin([...session.worker.getLinks()])
      .pipe(
        tap((links) => {
          session.parsedLinks = links;
          const options = links
            .filter((i) => Boolean(i))
            .some(
              ({ qualityLinkList }) =>
                Array.isArray(qualityLinkList) && qualityLinkList.length > 1,
            )
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Get full data",
                        callback_data: stepEnum.WORKER_GET_FULL_LINK,
                      },
                    ],
                  ],
                },
              }
            : {};
          bot.sendMessage(
            session.chatId,
            formatLinksMessage(
              links,
              session.worker.title,
              session.filename === "rezka.ag",
            ),
            { parse_mode: "HTML", ...options },
          );
        }),
        take(1),
        catchError((err) => {
          handleError(err, session.chatId);
          return throwError(err);
        }),
      )
      .subscribe();
  });

  step.on(stepEnum.WORKER_GET_FULL_LINK, (session) => {
    session.currentStep = stepEnum.WORKER_GET_FULL_LINK;
    const textArr = formatFullLinksMessage(
      session.parsedLinks,
      session.worker.title,
    );
    textArr.forEach((text, i) => {
      textArr[i] = bot.sendMessage(session.chatId, text, {
        parse_mode: "HTML",
      });
    });
    Promise.all(textArr);
  });

  step.on(stepEnum.WORKER_UPLOAD, (session) => {
    session.currentStep = stepEnum.WORKER_UPLOAD;
    session.worker
      .upload()
      .pipe(
        switchMap((data) => handleUploadProgress(data, session)),
        filter((message_id) => Boolean(message_id)),
        sampleTime(300),
        tap((message_id) => updateUploadProgress(message_id, session)),
        catchError((err) => {
          handleError(err, session.chatId);
          return throwError(err);
        }),
      )
      .subscribe();
  });

  step.on(stepEnum.WORKER_TO_FILE, (session) => {
    session.currentStep = stepEnum.WORKER_TO_FILE;
    session.worker
      .toFile(session.chatId)
      .pipe(
        tap((json) => {
          const options = {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Download",
                    callback_data: stepEnum.WORKER_DOWNLOAD_FROM_JSON,
                  },
                ],
              ],
            },
          };
          bot.sendMessage(
            session.chatId,
            "Ready: " + json.replace("download/", ""),
            { parse_mode: "HTML", ...options },
          );
        }),
        catchError((err) => {
          handleError(err, session.chatId);
          return throwError(err);
        }),
      )
      .subscribe();
  });

  step.on(stepEnum.WORKER_DOWNLOAD_FROM_JSON, (session) => {
    session.currentStep = stepEnum.WORKER_DOWNLOAD_FROM_JSON;
    const jsonFilePath = session.worker.jsonFile;
    console.log("jsonFilePath", jsonFilePath);
    const downloadProcess = spawn("./download_series.sh", [jsonFilePath]);

    downloadProcess.stdout.on("data", (data) => {
      console.log("stdout:", data.toString());
      bot.sendMessage(session.chatId, data.toString());
    });
    downloadProcess.stderr.on("data", (data) => {
      console.error("stderr:", data.toString());
      bot.sendMessage(session.chatId, data.toString());
    });
    bot.sendMessage(session.chatId, "⏳ Завантаження у фоні!");
    console.log("🚀 Скрипт запущено у фоні!");
  });

  step.on(stepEnum.WORKER_PARSE, (session) => {
    session.currentStep = stepEnum.WORKER_PARSE;
    session.worker.parse();
    bot.sendMessage(session.chatId, "Done");
  });

  step.on(stepEnum.WORKER_PARSE_OR_UPLOAD, (session) => {
    session.currentStep = stepEnum.WORKER_PARSE_OR_UPLOAD;
    bot.sendMessage(session.chatId, "Parse or upload?", {
      reply_markup: { inline_keyboard: session.worker.parseOrUploadKeyboard },
    });
  });

  step.on(stepEnum.WORKER_GET_TRANSLATOR, (session) => {
    session.currentStep = stepEnum.WORKER_GET_TRANSLATOR;
    bot.sendMessage(
      session.chatId,
      "Chose translator",
      session.worker.translatorKeyboard,
    );
  });

  step.on(stepEnum.WORKER_GET_SEASON, (session) => {
    session.currentStep = stepEnum.WORKER_GET_SEASON;
    session.worker
      .getEpisodes()
      .pipe(
        tap(() =>
          bot.sendMessage(
            session.chatId,
            "Chose season",
            session.worker.seasonKeyboard,
          ),
        ),
        take(1),
      )
      .subscribe();
  });

  step.on(stepEnum.WORKER_GET_EPISODES, (session, season) => {
    session.currentStep = stepEnum.WORKER_GET_EPISODES;
    if (season && season.includes("full:")) {
      session.worker.season = season.replace("full:", "");
      session.worker.setSelectedEpisodesBySesone(session.worker.seasonId);
      const step = session.worker.getNextStep(session.currentStep);
      session.step.emit(step || stepEnum.WORKER_PARSE_OR_UPLOAD, session);
    } else {
      session.worker.season = season;
      session.worker
        .getEpisodes()
        .pipe(
          tap(() => selectSeries(session, session.chatId)),
          take(1),
        )
        .subscribe();
    }
  });

  step.on(stepEnum.WORKER_JOB, (session) => {
    session.currentStep = stepEnum.WORKER_JOB;
    session.worker
      .loadPage()
      .pipe(
        catchError((err) => {
          handleError(err, session.chatId);
        }),
        tap((newStep) => {
          bot.sendMessage(
            session.chatId,
            `<a href="${session.worker.pageLink}">${session.worker.title}</a>`,
            {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            },
          );
          session.step.emit(newStep, session, session.worker.seasonId);
        }),
        take(1),
      )
      .subscribe();
  });

  step.on(stepEnum.GET_WORKER, (session, text) => {
    session.currentStep = stepEnum.GET_WORKER;
    const filename = urlParser.parse(text);
    const filepath = `${__dirname}/providers/${filename}.js`;
    if (!filename || !fs.existsSync(filepath)) {
      bot.sendMessage(session.chatId, "unknown url");
      return;
    }

    try {
      const link =
        text.match("http[s]?:\\/\\/[^\\s\\/$.?#].[^\\s]*")?.at(0) || text;
      const Worker = require(filepath);
      session.worker = new Worker(link);
      session.filename = filename;
      session.step.emit(stepEnum.WORKER_JOB, session);
    } catch (e) {
      handleError(e, session.chatId);
    }
  });
};

const formatLinksMessage = (links, title, useProxy) => {
  const proxy = useProxy ? "https://rezka.fayvlad.workers.dev/?target=" : "";
  return links.reduce((res, cur) => {
    if (cur) {
      res += `<a href="${proxy}${cur.link}">${cur.name} (${cur.quality})</a>\n`;
    }

    return res;
  }, `${title}\n\n`);
};

const formatFullLinksMessage = (parsedLinks, title) => {
  let i = 0;
  return parsedLinks.reduce(
    (resArr, cur) => {
      if (!cur) {
        return resArr;
      }

      let res = `${cur.name}\n`;
      res +=
        cur.qualityLinkList
          .map(({ quality, links }) => {
            const list = links
              .filter((url) => !url.includes("m3u"))
              .map((url, ix) => `<a href="${url}">Link - ${1 + ix}</a>`)
              .join("   ");
            return `${quality}   ${list}\n`;
          })
          .join("") + "\n\n";
      if (resArr[i].length + res.length > 4090) {
        i++;
      }

      resArr[i] = (resArr[i] || "") + res;
      return resArr;
    },
    [`${title}\n\n`],
  );
};

const handleUploadProgress = (data, session) => {
  if (!data.progress) {
    return from(
      bot
        .sendMessage(session.chatId, `${data.fileName}--${data.status}`)
        .then((msg) => {
          session.progressMessageId.set(data.fileName, msg.message_id);
          return msg.message_id;
        }),
    ).pipe(map(() => session.progressMessageId.get(data.fileName)));
  }

  let message = `${data.fileName}--${data.status}--${data.progress}%`;
  if (data.link) {
    message = `<a href="${data.link}">${message}</a>`;
  }

  return of(session.progressMessageId.get(data.fileName));
};

const updateUploadProgress = (message_id, session) => {
  if (message_id) {
    try {
      bot.editMessageText(message, {
        chat_id: session.chatId,
        message_id,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (e) {
      handleError(e, session.chatId);
    }
  }
};

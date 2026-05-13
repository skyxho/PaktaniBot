import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  proto
} from "@whiskeysockets/baileys";
import TelegramBot from "node-telegram-bot-api";
import pino from "pino";
import chalk from "chalk";
import readline from "readline";

const tg = "8797409935:AAHQX1Gsq57H2VOBD4Q53JmrYF7ly_I_MxI";
const bot = new TelegramBot(tg, { polling: true });
const logger = pino({ level: "silent" });
const usePairingCode = true;

let waSocket = null;
let isConnected = false;

async function question(prompt) {
  process.stdout.write(prompt);
  const r1 = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => r1.question("", (ans) => {
    r1.close();
    resolve(ans);
  }));
}

// ── WhatsApp ── //
async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`⚙️  ZhuXz v0.0.2 | WA v${version.join(".")} | isLatest: ${isLatest}`);

  waSocket = makeWASocket({
    version,
    logger,
    printQRInTerminal: !usePairingCode,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    auth: state,
    getMessage: async () => proto.Message.fromObject({}),
  });

  if (usePairingCode && !waSocket.authState.creds.registered) {
    try {
      console.log(chalk.green("🪴 Masukan Nomor Kamu +62xxx:"));
      const phoneNumber = await question("> ");
      const code = await waSocket.requestPairingCode(phoneNumber.trim());
      console.log(chalk.cyan(`🔗 Kode Pairing: ${code}`));
    } catch (err) {
      console.error(chalk.red("Gagal ambil pairing code:"), err);
    }
  }

  waSocket.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      isConnected = true;
      console.log(chalk.green("✅ WA Terhubung!"));
      console.log(chalk.cyan("🤖 Bot Telegram siap menerima perintah!\n"));
    } else if (connection === "close") {
      isConnected = false;
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(chalk.red("\n❌ Koneksi terputus, mencoba ulang..."));
      if (reason !== DisconnectReason.loggedOut) {
        console.log(chalk.yellow("🔄 Reconnecting..."));
        startWA();
      } else {
        console.log(chalk.red("💀 Logout terdeteksi. Hapus session & scan ulang."));
      }
    }
  });

  waSocket.ev.on("creds.update", saveCreds);
}

// ── Cek Nomor  ── //
async function checkWANumber(phoneNumber) {
  const clean = phoneNumber.replace(/[^0-9]/g, "");
  const [result] = await waSocket.onWhatsApp(`${clean}@s.whatsapp.net`);
  return { clean, exists: result?.exists ?? false };
}

// ── Telegram Bot ── //
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 *Halo!* Saya bot cek nomor WhatsApp\\.\n\n` +
    `Kirim nomor HP dengan format:\n`,
    { parse_mode: "Markdown" }
  );
});

bot.on("message", async (msg) => {
  let searching;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    const chatId = msg.chat.id;
    const input = msg.text?.trim() || "";

    const numbers = input
      .split(/[\n,]+/)
      .map(v => v.trim())
      .filter(v => /^[0-9+\-\s()]{6,15}$/.test(v));

    if (!numbers.length) return;
    if (input.startsWith("/")) return;

    if (!isConnected) {
      return bot.sendMessage(
        chatId,
        "⏳ WhatsApp belum terhubung, coba beberapa saat lagi."
      );
    }

    const typing = () => bot.sendChatAction(chatId, "typing");

    // Step 1
    await delay(500);
    await typing();
    await delay(1000);

    searching = await bot.sendMessage(
      chatId,
      `⏳ <b>Memproses permintaan...</b>`,
      { parse_mode: "HTML" }
    );

    // Step 2
    await delay(800);
    await typing();
    await delay(800);

    await bot.editMessageText(
      `🔍 <b>Mencari nomor...</b>`,
      {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: "HTML"
      }
    );

    // Step 3
    await delay(1000);
    await typing();
    await delay(800);

    await bot.editMessageText(
      `📡 <b>Menghubungi server WhatsApp...</b>`,
      {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: "HTML"
      }
    );

    let resultText = `\n`;

    for (const num of numbers) {
      const { clean, exists } = await checkWANumber(num);

      resultText +=
        `📱 <code>${clean}</code>\n` +
        `└ ${exists ? "✅ Terdaftar" : "❌ Tidak Terdaftar"}\n\n`;
    }

    // Step 4
    await delay(1200);
    await typing();
    await delay(800);

    await bot.editMessageText(
      `🧩 <b>Memproses hasil...</b>`,
      {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: "HTML"
      }
    );

    // Step 5
    await delay(1000);
    await typing();
    await delay(600);

    await bot.editMessageText(resultText, {
      chat_id: chatId,
      message_id: searching.message_id,
      parse_mode: "HTML"
    });

  } catch (err) {
    console.error(err);

    if (searching) {
      await bot.editMessageText(
        `⚠️ <b>Gagal mengecek nomor</b>\n\n<code>${err.message}</code>`,
        {
          chat_id: msg.chat.id,
          message_id: searching.message_id,
          parse_mode: "HTML"
        }
      );
    } else {
      await bot.sendMessage(
        msg.chat.id,
        `⚠️ Gagal mengecek nomor\n\n${err.message}`
      );
    }
  }
});

// ── Start ── //
console.log(
  chalk.yellow.bold(`
⡏⠉⠛⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⣿
⣿⠀⠀⠀⠈⠛⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠛⠉⠁⠀⣿
⣿⣧⡀⠀⠀⠀⠀⠙⠿⠿⠿⠻⠿⠿⠟⠿⠛⠉⠀⠀⠀⠀⠀⣸⣿
⣿⣿⣷⣄⠀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿
⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⣴⣿⣿⣿⣿
⣿⣿⣿⡟⠀⠀⢰⣹⡆⠀⠀⠀⠀⠀⠀⣭⣷⠀⠀⠀⠸⣿⣿⣿⣿
⣿⣿⣿⠃⠀⠀⠈⠉⠀⠀⠤⠄⠀⠀⠀⠉⠁⠀⠀⠀⠀⢿⣿⣿⣿
⣿⣿⣿⢾⣿⣷⠀⠀⠀⠀⡠⠤⢄⠀⠀⠀⠠⣿⣿⣷⠀⢸⣿⣿⣿
⣿⣿⣿⡀⠉⠀⠀⠀⠀⠀⢄⠀⢀⠀⠀⠀⠀⠉⠉⠁⠀⠀⣿⣿⣿
⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢹⣿⣿
⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿
`) + chalk.cyan.bold(`@𝗟𝗲𝘅𝘇𝗦𝘁𝗼𝗿𝗲`) + "\n\n" +
  chalk.yellow.bold(`𝗥𝗲𝘅𝘇𝗦𝘂𝗸𝗶 𝗕𝗼𝘁 [ 𝗱𝗲𝘃 ] 𝗯𝗲𝘁𝗮 𝘃𝗲𝗿𝘀𝗶𝗼𝗻`)
);

console.log(chalk.blue("🌐 Menghubungkan..."));
startWA();
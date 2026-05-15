import { fileURLToPath } from "url";
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
import fs from "fs";
import path from "path";

// ── DIRNAME ── //
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

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

// ── Cek Nomor ── //
async function checkWANumber(phoneNumber) {
  const clean = phoneNumber.replace(/[^0-9]/g, "");
  const [result] = await waSocket.onWhatsApp(`${clean}@s.whatsapp.net`);
  return { clean, exists: result?.exists ?? false };
}

// ── Telegram Bot ── //
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
        "⏳ WhatsApp пока не подключен, пожалуйста, попробуйте позже..."
      );
    }

    const typing = () => bot.sendChatAction(chatId, "typing");

    searching = await bot.sendMessage(chatId, `⏳ <b>процесс...</b>`, {
      parse_mode: "HTML"
    });

    await delay(800);
    await typing();
    await delay(800);

    await bot.editMessageText(
      `🔍 <b>поиск числа...</b>`,
      {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: "HTML"
      }
    );

    let notRegistered = [];
    let registered = [];

    for (const num of numbers) {
      const { clean, exists } = await checkWANumber(num);
      if (exists) {
        registered.push(clean);
      } else {
        notRegistered.push(clean);
      }
    }

    // ── Generate F ── //
    const now = new Date();
    const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
    const dayName = days[now.getDay()];
    const dd      = String(now.getDate()).padStart(2, "0");
    const mm      = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy    = now.getFullYear();
    const hh      = String(now.getHours()).padStart(2, "0");
    const min     = String(now.getMinutes()).padStart(2, "0");

    const baseName = `${dd}-${mm}-${yyyy}_${hh}-${min}_${dayName}`;
    const tmpDir   = path.join(__dirname, "tmp_results");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const fileNotReg = path.join(tmpDir, `${baseName}_tidak-terdaftar.txt`);
    const fileReg    = path.join(tmpDir, `${baseName}_terdaftar.txt`);

    const headerNotReg =
      `=== HASIL CEK WHATSAPP ===\n` +
      `Tanggal : ${dd}/${mm}/${yyyy} ${hh}:${min} (${dayName})\n` +
      `Status  : Tidak Terdaftar\n` +
      `Total   : ${notRegistered.length} nomor\n` +
      `${"=".repeat(30)}\n\n`;

    const headerReg =
      `=== HASIL CEK WHATSAPP ===\n` +
      `Tanggal : ${dd}/${mm}/${yyyy} ${hh}:${min} (${dayName})\n` +
      `Status  : Terdaftar\n` +
      `Total   : ${registered.length} nomor\n` +
      `${"=".repeat(30)}\n\n`;

    fs.writeFileSync(
      fileNotReg,
      headerNotReg + (notRegistered.length ? notRegistered.join("\n") : "(kosong)")
    );
    fs.writeFileSync(
      fileReg,
      headerReg + (registered.length ? registered.join("\n") : "(kosong)")
    );

    await delay(1000);
    await typing();
    await delay(600);

    const summaryText =
      `📊 <b>Общие ( ${numbers.length} )</b>\n\n` +
      `❌ Tidak : <b>${notRegistered.length}</b> nomor\n` +
      `✅ Yakk : <b>${registered.length}</b> nomor`;

    await bot.editMessageText(summaryText, {
      chat_id: chatId,
      message_id: searching.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: `❌ Get File (${notRegistered.length})`, callback_data: `file_notReg_${baseName}` }],
          [{ text: `✅ Get File (${registered.length})`,          callback_data: `file_Reg_${baseName}` }]
        ]
      }
    });

    if (!global._resultFiles) global._resultFiles = {};
    global._resultFiles[`file_notReg_${baseName}`] = fileNotReg;
    global._resultFiles[`file_Reg_${baseName}`]    = fileReg;

  } catch (err) {
    console.error(err);
    if (searching) {
      await bot.editMessageText(
        `⚠️ <b>Gagal mengecek nomor</b>\n\n<code>${err.message}</code>`,
        { chat_id: msg.chat.id, message_id: searching.message_id, parse_mode: "HTML" }
      );
    } else {
      await bot.sendMessage(msg.chat.id, `⚠️ Gagal mengecek nomor\n\n${err.message}`);
    }
  }
});

// ── Handler callback_query ── //
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;

  if (!data.startsWith("file_notReg_") && !data.startsWith("file_Reg_")) return;

  await bot.answerCallbackQuery(query.id, { text: "⏳ Mengambil file..." });

  const filePath = global._resultFiles?.[data];

  if (!filePath || !fs.existsSync(filePath)) {
    return bot.sendMessage(chatId, "⚠️ File tidak ditemukan atau sudah dihapus.");
  }

  const isNotReg = data.startsWith("file_notReg_");
  const caption  = isNotReg
    ? `❌ <b>File Tidak Terdaftar</b>`
    : `✅ <b>File Terdaftar</b>`;

  await bot.sendDocument(chatId, filePath, { caption, parse_mode: "HTML" });
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
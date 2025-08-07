require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const cooldown = new Map();
const statsPath = './stats.json'; // Path untuk file statistik

// Load stats file
let botStats = { totalVideosDownloaded: 0 };
if (fs.existsSync(statsPath)) {
  try {
    botStats = JSON.parse(fs.readFileSync(statsPath));
  } catch {
    botStats = { totalVideosDownloaded: 0 };
  }
}

// Helper Functions
const isValidTikTok = (url) => /^https:\/\/(www|vm|vt)\.tiktok\.com\/.+/.test(url);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const resolveTikTokLink = async (url) => {
  try {
    const res = await axios.head(url, {
      maxRedirects: 5,
      validateStatus: status => status >= 200 && status < 400,
    });
    return res.request?.res?.responseUrl || url;
  } catch {
    return url;
  }
};

// Function to save statistics
const saveStats = () => {
  fs.writeFileSync(statsPath, JSON.stringify(botStats, null, 2));
};

// User state to track menu choices
const userState = new Map(); // Tracks the state for each chatId

// Helper for Logging
const logActivity = (type, chatId, username, message) => {
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    console.log(`[${timestamp}] [${type}] ChatID: ${chatId} | @${username || 'N/A'}: ${message}`);
};

// Variatif
const cooldownMessages = [
    `⏳😁 Tunggu bentar ya tod, ada cooldown 3 detik antar permintaan.`,
    `🚨 Woy santai dulu, ada jeda 3 detik sebelum permintaan selanjutnya.`,
    `💨 Jangan buru-buru bro/sis, 3 detik lagi bisa kok!`
];

const successMessages = [
    `kelar`,
    `Video berhasil diunduh dan dikirim! Mantap! 🎉`,
    `Mendarat mulus! Ada link lain yang mau diangkut? 🚀`,
    `Selesai! Tinggal tonton deh. Lanjut? 😎`
];

const generalErrorMessages = [
    `💥 Aduh, terjadi error saat memproses permintaanmu. Coba kirim ulang dah.`,
    `😢 Yah, ada yang gak beres nih. Coba lagi bentar ya.`,
    `⚠️ Error internal bot. Maaf ya, coba lagi nanti. Atau kontak @alritech deh kalo sering gini.`
];

// Main Message Handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  const username = msg.from.username || msg.from.first_name; // Get username or first name

  // Log incoming message
  logActivity('INCOMING_MSG', chatId, username, `"${text}"`);

  if (!text) return;

  // Cooldown 3 seconds
  const COOLDOWN_MS = 3000; // 3 seconds
  const lastUsed = cooldown.get(chatId) || 0;
  if (Date.now() - lastUsed < COOLDOWN_MS) {
    if (userState.get(chatId) !== 'awaiting_menu_choice') {
        logActivity('COOLDOWN_ACTIVE', chatId, username, `Cooldown aktif, sisa ${COOLDOWN_MS - (Date.now() - lastUsed)}ms`);
        const randomCooldownMsg = cooldownMessages[Math.floor(Math.random() * cooldownMessages.length)];
        return bot.sendMessage(chatId, randomCooldownMsg);
    } else {
        return;
    }
  }
  cooldown.set(chatId, Date.now());

  // If "/start", show the main menu and then the YouTube link
  if (text === "/start") {
    userState.set(chatId, 'awaiting_menu_choice'); // Set state to await menu choice
    logActivity('COMMAND', chatId, username, 'Executed /start');

    // Animasi pesan awal
    await bot.sendMessage(chatId, "Halo! Welcome to **Nrw Bot** 🤑.");
    await sleep(400); 
    await bot.sendMessage(chatId, "Bot by @alritech");
    await sleep(400); 
    await bot.sendMessage(chatId, "Di sini kamu bisa download video tiktod no watermark (rillcuy no pek2 😏)");
    await sleep(600); 

    return bot.sendMessage(chatId, "Pilih:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎵 TikTok Downloader", callback_data: "tiktok_downloader" }],
                [{ text: "📊 Statistik Bot", callback_data: "show_stats" }], 
                [{ text: "YouTube Saya", url: "https://www.youtube.com/@TechwareZone" }] 
            ]
        }
    });
  }

  // If the state is 'tiktok_mode', process as a TikTok link
  if (userState.get(chatId) === 'tiktok_mode') {
    if (!isValidTikTok(text)) {
      logActivity('INVALID_LINK', chatId, username, 'Invalid TikTok link');
      return bot.sendMessage(chatId, "Kita hanya menerima pesan link vt aja bos q. Kalau bingung, coba ketik /start bwat kembali ke menu. 👆");
    }

    logActivity('PROCESS_START', chatId, username, 'Processing TikTok link');
    await bot.sendChatAction(chatId, 'typing');
    // Pesan loading tahap 1
    const processingMessage = await bot.sendMessage(chatId, "⏳ Memeriksa tautan video kamu... Mohon tunggu ya!"); 

    try {
      const finalUrl = await resolveTikTokLink(text);

      // Pembaruan pesan loading tahap 2 (NEW)
      await sleep(1500); 
      await bot.editMessageText("✨ Mengambil data dari server TikTok... Dikit lagi!", {
          chat_id: chatId,
          message_id: processingMessage.message_id
      }).catch(e => console.log("Error editing message:", e.message)); 

      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(finalUrl)}&hd=1`;
      const response = await axios.get(apiUrl, { timeout: 20000 }); // Tambah timeout 20 detik (NEW)
      const video = response.data?.data;

      if (!video) {
        logActivity('API_FAIL', chatId, username, 'Failed to get video data from API');
        // Pesan error spesifik jika video tidak ditemukan di API (NEW)
        await bot.editMessageText("😢 Video tidak ditemukan atau sudah dihapus dari TikTok. Coba link lain.", {
          chat_id: chatId,
          message_id: processingMessage.message_id
        });
        return;
      }

      // Pesan loading tahap 3 (NEW)
      await sleep(1500);
      await bot.editMessageText("🚀 Video siap diunggah ke Telegram... Sabar ya! 📤", {
          chat_id: chatId,
          message_id: processingMessage.message_id
      }).catch(e => console.log("Error editing message:", e.message));

      // 🌟 Video Info
      const infoMessageText = `🌟 Info Video:
👤 User: @${video.author?.unique_id || 'unknown'}
🎵 Musik: ${video.music?.title || '-'}
👁️ Intip: ${video.play_count || 0}
❤️ Like: ${video.digg_count || 0}
🔗 Link Asli: ${video.share_url || '-'}`;

      logActivity('VIDEO_INFO_SENT', chatId, username, `Video info for ${video.author?.unique_id || 'N/A'}`);
      await bot.editMessageText(infoMessageText, {
        chat_id: chatId,
        message_id: processingMessage.message_id
      });

      await sleep(600);

      const videoUrl = video.hdplay;
      if (!videoUrl) {
        logActivity('NO_VIDEO_URL', chatId, username, 'No direct video URL found');
        await bot.sendMessage(chatId, "💥 Gagal ambil video. URL video tidak ditemukan."); // Pesan lebih spesifik (NEW)
        return;
      }

      logActivity('UPLOADING_VIDEO', chatId, username, 'Uploading video to Telegram');
      await bot.sendChatAction(chatId, 'upload_video');

      await bot.sendVideo(chatId, videoUrl, {
        caption: `🎬 @${video.author?.unique_id || 'user'}\n🎵 ${video.music?.title || 'No music info'}`
      });

      botStats.totalVideosDownloaded++;
      saveStats(); 
      logActivity('VIDEO_SUCCESS', chatId, username, 'Video sent successfully');

      // Pesan konfirmasi dengan variasi (NEW)
      const randomSuccessMsg = successMessages[Math.floor(Math.random() * successMessages.length)];
      await bot.sendMessage(chatId, randomSuccessMsg, { // Tambah inline keyboard (NEW)
          reply_markup: {
              inline_keyboard: [
                  [{ text: "✅ Unduh Lagi", callback_data: "tiktok_downloader" }], 
                  [{ text: "🏠 Menu Utama", callback_data: "start_menu" }] 
              ]
          }
      });

    } catch (err) {
      logActivity('ERROR', chatId, username, `Processing failed: ${err.message}`);
      let errorMessage = generalErrorMessages[Math.floor(Math.random() * generalErrorMessages.length)]; // Pesan error umum dengan variasi

      // Deteksi error timeout atau network (NEW)
      if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
          errorMessage = "⏰ Aduh, server TikTok/API lagi sibuk banget nih. Coba lagi beberapa detik ya!";
      } else if (axios.isAxiosError(err) && !err.response) {
          errorMessage = "🔌 Gagal nyambung ke server. Koneksi internet bot mungkin ada masalah, atau API sedang down. Coba lagi nanti.";
      }

      await bot.editMessageText(errorMessage, { // Mengedit pesan loading dengan error (NEW)
        chat_id: chatId,
        message_id: processingMessage.message_id
      }).catch(e => console.log("Error editing message after failure:", e.message)); // Catch error jika pesan sudah tidak ada

      console.error("DEBUG_ERROR_DETAIL:", err); // Log error lengkap untuk debugging
    }
  } else {
    logActivity('UNHANDLED_MSG', chatId, username, 'Message in wrong mode');
    return bot.sendMessage(chatId, "Kami hanya bisa menerima Link vt (video tiktok), selain itu ga bisa, jika butuh bantuan pencet /start");
  }
});

// --- Callback Query Handler for Inline Keyboards ---
bot.on('callback_query', async (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const data = callbackQuery.data;
  const username = callbackQuery.from.username || callbackQuery.from.first_name;

  logActivity('CALLBACK_QUERY', chatId, username, `Data: "${data}"`);

  // Remove the inline keyboard from the message after it's clicked
  try {
    await bot.editMessageReplyMarkup(
      null, 
      {
        chat_id: chatId,
        message_id: message.message_id,
        reply_markup: {
          inline_keyboard: [] 
        }
      }
    );
    logActivity('MENU_CLEARED', chatId, username, 'Inline keyboard removed');
  } catch (e) {
    console.error("Error editing message reply markup:", e);
  }

  if (data === 'tiktok_downloader') {
    userState.set(chatId, 'tiktok_mode'); 
    logActivity('MODE_CHANGE', chatId, username, 'Switched to TikTok Downloader');
    await bot.sendMessage(chatId, "Siap... TikTok. Mana link? 👇"); 
  } 
  else if (data === 'show_stats') { 
    userState.delete(chatId); 
    logActivity('SHOW_STATS', chatId, username, `Displayed stats: ${botStats.totalVideosDownloaded} videos`);
    await bot.sendMessage(chatId, `📊 Statistik Bot:
Kembali ketik /start, Total video berhasil diunduh: ${botStats.totalVideosDownloaded} ✅`); 
  } else if (data === 'start_menu') { // Handle "Menu Utama" button (NEW)
      userState.set(chatId, 'awaiting_menu_choice');
      logActivity('MODE_CHANGE', chatId, username, 'Returned to start menu via button');
      // Re-trigger the /start logic
      await bot.sendMessage(chatId, "Halo! Welcome to Nrw Bot 🤑.");
      await sleep(400); 
      await bot.sendMessage(chatId, "Bot by @alritech");
      await sleep(400); 
      await bot.sendMessage(chatId, "Di sini kamu bisa download video tiktod no watermark (rillcuy no pek2 😏)");
      await sleep(600); 

      await bot.sendMessage(chatId, "Pilih:", {
          reply_markup: {
              inline_keyboard: [
                  [{ text: "🎵 TikTok Downloader", callback_data: "tiktok_downloader" }],
                  [{ text: "📊 Statistik Bot", callback_data: "show_stats" }], 
                  [{ text: "YouTube Saya", url: "https://www.youtube.com/@TechwareZone" }] 
              ]
          }
      });
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

// Catch any polling errors for better debugging
bot.on('polling_error', (error) => {
  console.error(`[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta'})}] [POLLING_ERROR]`, error.code, error.message);
});

// Confirmation that bot is running
console.log(`[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta'})}] Bot is running and polling for messages...`);
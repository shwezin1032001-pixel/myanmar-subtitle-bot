require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3001;
const ENV_PATH = path.join(__dirname, '.env');
const TEMP_DIR = path.join(__dirname, 'temp_storage');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  process.env.TELEGRAM_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
}

const userSessions = new Map();
const projectStore = new Map();

const TRANSLATION_STYLES = {
  natural: 'Natural (သဘာဝကျကျ နေ့စဉ်သုံးစကား)',
  professional: 'Professional (ရုံးသုံး/စာပေစကားပြေ)',
  casual: 'Casual (ပေါ့ပေါ့ပါးပါး သူငယ်ချင်းစကား)',
  funny: 'Funny (ဟာသနှောသော စကားအသုံးအနှုန်း)',
  dramatic: 'Dramatic (ဇာတ်ကားဆန်ဆန် ပြင်းပြသောခံစားချက်)',
  social: 'Social Media (ဆွဲဆောင်မှုရှိသော ဆိုရှယ်မီဒီယာသုံးစကား)'
};

const SOCIAL_PRESETS = {
  original: { name: 'Original Aspect Ratio', scale: null },
  tiktok: { name: 'TikTok / Shorts (9:16 - 1080x1920)', scale: '1080:1920' },
  square: { name: 'Instagram Square (1:1 - 1080x1080)', scale: '1080:1080' },
  portrait: { name: 'FB / IG Portrait (4:5 - 1080x1350)', scale: '1080:1350' },
  youtube_1080p: { name: 'YouTube 16:9 (1080p)', scale: '1920:1080' }
};

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

function updateEnvFile(updates) {
  let existingContent = '';
  if (fs.existsSync(ENV_PATH)) {
    existingContent = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  const lines = existingContent ? existingContent.split('\n') : [];
  const processedKeys = new Set();

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return line;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (updates.hasOwnProperty(key)) {
      processedKeys.add(key);
      const val = updates[key] !== undefined ? updates[key] : '';
      return `${key}=${val}`;
    }
    return line;
  });

  for (const [key, val] of Object.entries(updates)) {
    if (!processedKeys.has(key)) {
      updatedLines.push(`${key}=${val || ''}`);
    }
  }

  fs.writeFileSync(ENV_PATH, updatedLines.join('\n').trim() + '\n', 'utf-8');
}

function renderSettingsPage() {
  const isBotSet = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim());
  const isGeminiSet = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const currentPort = process.env.PORT || 3001;
  const currentBaseUrl = process.env.PUBLIC_BASE_URL || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Myanmar Subtitle Bot - Settings</title>
  <style>
    :root {
      --bg: #0f172a; --card-bg: #1e293b; --accent: #3b82f6; --text: #f8fafc;
      --text-muted: #94a3b8; --border: #334155; --success: #10b981; --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 480px; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 1.35rem; margin-bottom: 6px; }
    .header p { font-size: 0.85rem; color: var(--text-muted); }
    .card { background-color: var(--card-bg); border-radius: 14px; border: 1px solid var(--border); padding: 20px; margin-bottom: 16px; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px; margin-top: 4px; font-weight: 600; }
    .status-badge.ok { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .status-badge.missing { background: rgba(239, 68, 68, 0.15); color: var(--danger); }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; color: #cbd5e1; }
    input[type="password"], input[type="text"], input[type="number"] {
      width: 100%; padding: 12px 14px; font-size: 0.95rem; border-radius: 8px;
      border: 1px solid var(--border); background-color: #0b1120; color: #fff; outline: none;
    }
    input:focus { border-color: var(--accent); }
    .hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; }
    .btn {
      width: 100%; background-color: var(--accent); color: white; border: none; padding: 13px;
      font-size: 1rem; font-weight: 600; border-radius: 8px; cursor: pointer;
    }
    #alertBox { padding: 12px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 16px; display: none; }
    #alertBox.success { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid var(--success); }
    #alertBox.error { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid var(--danger); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🇲🇲 Myanmar Subtitle Bot</h1>
      <p>Secure Credentials & Bot Configuration</p>
    </div>
    <div id="alertBox"></div>
    <form id="settingsForm" class="card">
      <div class="form-group">
        <label for="TELEGRAM_BOT_TOKEN">
          Telegram Bot Token
          <span class="status-badge ${isBotSet ? 'ok' : 'missing'}">
            ${isBotSet ? '● Saved' : '○ Not Set'}
          </span>
        </label>
        <input type="password" id="TELEGRAM_BOT_TOKEN" name="TELEGRAM_BOT_TOKEN" placeholder="${isBotSet ? '••••••••••••••••••••••••••••' : 'Enter Bot Token from @BotFather'}" autocomplete="off">
        <p class="hint">Token ကို ဘယ်သူမှ မြင်တွေ့ရမည်မဟုတ်ပါ။</p>
      </div>

      <div class="form-group">
        <label for="GEMINI_API_KEY">
          Gemini API Key
          <span class="status-badge ${isGeminiSet ? 'ok' : 'missing'}">
            ${isGeminiSet ? '● Saved' : '○ Not Set'}
          </span>
        </label>
        <input type="password" id="GEMINI_API_KEY" name="GEMINI_API_KEY" placeholder="${isGeminiSet ? '••••••••••••••••••••••••••••' : 'Enter Google AI Studio Key'}" autocomplete="off">
        <p class="hint">Speech-to-Text နှင့် မြန်မာပြန်ဆိုရန် အသုံးပြုပါသည်။</p>
      </div>

      <div class="form-group">
        <label for="PUBLIC_BASE_URL">Public HTTPS Base URL</label>
        <input type="text" id="PUBLIC_BASE_URL" name="PUBLIC_BASE_URL" value="${currentBaseUrl}" placeholder="https://your-bot-app.onrender.com">
      </div>

      <button type="submit" class="btn" id="saveBtn">Save Configuration</button>
    </form>
  </div>

  <script>
    const form = document.getElementById('settingsForm');
    const alertBox = document.getElementById('alertBox');
    const saveBtn = document.getElementById('saveBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      saveBtn.innerText = 'Saving...';
      alertBox.style.display = 'none';

      const payload = {
        TELEGRAM_BOT_TOKEN: document.getElementById('TELEGRAM_BOT_TOKEN').value.trim(),
        GEMINI_API_KEY: document.getElementById('GEMINI_API_KEY').value.trim(),
        PUBLIC_BASE_URL: document.getElementById('PUBLIC_BASE_URL').value.trim()
      };

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
          alertBox.className = 'success';
          alertBox.innerText = '✅ Credentials saved successfully!';
          alertBox.style.display = 'block';
          setTimeout(() => location.reload(), 1200);
        } else {
          throw new Error(result.error || 'Failed to update credentials.');
        }
      } catch (err) {
        alertBox.className = 'error';
        alertBox.innerText = '❌ Error: ' + err.message;
        alertBox.style.display = 'block';
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerText = 'Save Configuration';
      }
    });
  </script>
</body>
</html>`;
}

app.get(['/', '/settings'], (req, res) => {
  res.send(renderSettingsPage());
});

app.post('/api/settings', async (req, res) => {
  try {
    const { TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, PUBLIC_BASE_URL } = req.body;
    const updates = {};

    if (TELEGRAM_BOT_TOKEN) {
      updates.TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN;
    }
    if (GEMINI_API_KEY) {
      updates.GEMINI_API_KEY = GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = GEMINI_API_KEY;
    }
    if (PUBLIC_BASE_URL !== undefined) {
      updates.PUBLIC_BASE_URL = PUBLIC_BASE_URL.replace(/\/+$/, '');
      process.env.PUBLIC_BASE_URL = updates.PUBLIC_BASE_URL;
    }

    updateEnvFile(updates);

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.PUBLIC_BASE_URL) {
      try {
        const webhookUrl = `${process.env.PUBLIC_BASE_URL}/api/telegram/webhook`;
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
            allowed_updates: ['message', 'callback_query']
          })
        });
      } catch (err) {}
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function callWithRetry(fn, maxRetries = 5, delays = [1000, 2000, 4000, 8000, 16000]) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) await new Promise((res) => setTimeout(res, delays[i]));
    }
  }
  throw lastError;
}

function getTelegramBaseUrl() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error('Bot token is not configured.');
  return `https://api.telegram.org/bot${token}`;
}

async function telegramRequest(method, payload) {
  const res = await fetch(`${getTelegramBaseUrl()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API Error');
  return data.result;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await telegramRequest('sendMessage', payload);
}

async function updateTelegramMessage(chatId, messageId, text, replyMarkup = null) {
  try {
    const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return await telegramRequest('editMessageText', payload);
  } catch (e) {
    return null;
  }
}

async function getTelegramFileDirectUrl(fileId) {
  const fileInfo = await telegramRequest('getFile', { file_id: fileId });
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
}

async function downloadFileFromUrl(url, destPath) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

async function sendTelegramDocument(chatId, filePath, caption = '') {
  const boundary = `----TelegramBoundary${Date.now()}`;
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  const pre = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const post = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([Buffer.from(pre, 'utf-8'), fileBuffer, Buffer.from(post, 'utf-8')]);
  const res = await fetch(`${getTelegramBaseUrl()}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length.toString() },
    body
  });
  return (await res.json()).result;
}

async function sendTelegramVideo(chatId, filePath, caption = '') {
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);

  if (fileSizeMB > 48) {
    const baseUrl = process.env.PUBLIC_BASE_URL || '';
    if (baseUrl) {
      const downloadUrl = `${baseUrl}/api/download/${path.basename(filePath)}`;
      await sendTelegramMessage(chatId, `⚠️ <b>ဖိုင်ဆိုဒ် (${fileSizeMB.toFixed(1)} MB) ကြီးနေသဖြင့် ဒေါင်းလုဒ်ရယူပါ:</b>\n<a href="${downloadUrl}">${downloadUrl}</a>`);
      return;
    }
  }

  const boundary = `----TelegramBoundary${Date.now()}`;
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  const pre = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${fileName}"\r\nContent-Type: video/mp4\r\n\r\n`;
  const post = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([Buffer.from(pre, 'utf-8'), fileBuffer, Buffer.from(post, 'utf-8')]);
  const res = await fetch(`${getTelegramBaseUrl()}/sendVideo`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length.toString() },
    body
  });
  return (await res.json()).result;
}

function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

async function extractAudioWithFFmpeg(inputPath, outputPath) {
  await executeCommand(`ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k "${outputPath}"`);
}

function escapeFFmpegSubtitlePath(str) {
  return str.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function burnSubtitlesWithFFmpeg(videoInputPath, srtPath, videoOutputPath, presetKey = 'original') {
  const escapedSrt = escapeFFmpegSubtitlePath(srtPath);
  const subtitleStyle = "Fontname=Noto Sans Myanmar,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2.5,Shadow=1,Alignment=2,MarginV=35";
  let filterChain = `subtitles='${escapedSrt}':force_style='${subtitleStyle}'`;
  const preset = SOCIAL_PRESETS[presetKey] || SOCIAL_PRESETS.original;
  if (preset.scale) {
    const [w, h] = preset.scale.split(':');
    filterChain = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,${filterChain}`;
  }
  await executeCommand(`ffmpeg -y -i "${videoInputPath}" -vf "${filterChain}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${videoOutputPath}"`);
}

async function transcribeAudioWithGemini(audioFilePath) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const base64Audio = fs.readFileSync(audioFilePath).toString('base64');
  const systemPrompt = `Transcribe speech into SRT segments JSON array: [{"id":1,"start":"00:00:01,000","end":"00:00:03,500","text":"spoken words"}]. Strict standard SRT timestamps format HH:MM:SS,mmm. Pure JSON array only.`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: "Transcribe audio." }, { inlineData: { mimeType: "audio/mp3", data: base64Audio } }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { responseMimeType: "application/json" }
  };

  const responseText = await callWithRetry(async () => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  });

  return JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
}

async function translateToMyanmarWithGemini(segments, styleKey = 'natural') {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const selectedStyle = TRANSLATION_STYLES[styleKey] || TRANSLATION_STYLES.natural;
  const systemPrompt = `Translate segments into natural Myanmar Unicode (မြန်မာစာ). Preserve exact start/end timestamps. Return JSON array matching schema [{"id":1,"start":"00:00:01,000","end":"00:00:03,500","text":"မြန်မာစာ"}]. Style: ${selectedStyle}. Pure JSON only.`;

  const payload = {
    contents: [{ parts: [{ text: JSON.stringify(segments) }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { responseMimeType: "application/json" }
  };

  const responseText = await callWithRetry(async () => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  });

  return JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
}

function buildSrtContent(segments) {
  return segments.map((s, i) => `${i + 1}\n${s.start} --> ${s.end}\n${(s.text || '').trim()}\n`).join('\n');
}

async function processMediaJob({ chatId, fileId, fileName, isVideo, userStyle, userPreset }) {
  const projectId = `proj_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const basePrefix = path.join(TEMP_DIR, projectId);
  const rawInputPath = `${basePrefix}_input${path.extname(fileName) || (isVideo ? '.mp4' : '.mp3')}`;
  const extractedAudioPath = `${basePrefix}_extracted.mp3`;
  const originalSrtPath = `${basePrefix}_original.srt`;
  const myanmarSrtPath = `${basePrefix}_myanmar.srt`;
  const finalVideoPath = `${basePrefix}_subtitled.mp4`;

  let statusMessageId = null;
  const updateProgress = async (text) => {
    const fullText = `⚡ <b>Myanmar Subtitle Engine</b>\n📁 <code>${fileName}</code>\n\n${text}`;
    if (!statusMessageId) {
      const msg = await sendTelegramMessage(chatId, fullText);
      statusMessageId = msg.message_id;
    } else {
      await updateTelegramMessage(chatId, statusMessageId, fullText);
    }
  };

  try {
    await updateProgress('📥 <b>ဖိုင်ကို ရယူနေပါသည်...</b>');
    const telegramFileUrl = await getTelegramFileDirectUrl(fileId);
    await downloadFileFromUrl(telegramFileUrl, rawInputPath);

    await updateProgress('🎙️ <b>Extracting audio (FFmpeg)...</b>');
    await extractAudioWithFFmpeg(rawInputPath, extractedAudioPath);

    await updateProgress('📝 <b>Transcribing speech (Gemini AI)...</b>');
    const originalSegments = await transcribeAudioWithGemini(extractedAudioPath);
    fs.writeFileSync(originalSrtPath, buildSrtContent(originalSegments), 'utf-8');

    await updateProgress('🇲🇲 <b>Translating to Myanmar Unicode...</b>');
    const myanmarSegments = await translateToMyanmarWithGemini(originalSegments, userStyle);
    fs.writeFileSync(myanmarSrtPath, buildSrtContent(myanmarSegments), 'utf-8');

    if (isVideo) {
      await updateProgress('🎞️ <b>Burning Myanmar subtitles (FFmpeg)...</b>');
      await burnSubtitlesWithFFmpeg(rawInputPath, myanmarSrtPath, finalVideoPath, userPreset);
    }

    await updateProgress('📦 <b>ရလဒ်ဖိုင်များ ပေးပို့နေပါသည်...</b>');
    await sendTelegramDocument(chatId, originalSrtPath, `📄 <b>Original SRT</b>`);
    await sendTelegramDocument(chatId, myanmarSrtPath, `🇲🇲 <b>Myanmar SRT (Unicode)</b>`);

    if (isVideo) {
      await sendTelegramVideo(chatId, finalVideoPath, `🎬 <b>Myanmar Subtitled Video</b>`);
    }

    await updateTelegramMessage(chatId, statusMessageId, `✅ <b>အောင်မြင်စွာ ဆောင်ရွက်ပြီးစီးပါပြီ!</b>\n\nနောက်ထပ် ဗီဒီယို/အသံဖိုင် ပေးပို့နိုင်ပါသည်။`);
  } catch (error) {
    const errText = `❌ <b>မအောင်မြင်ပါ:</b> ${error.message}`;
    if (statusMessageId) await updateTelegramMessage(chatId, statusMessageId, errText);
    else await sendTelegramMessage(chatId, errText);
  } finally {
    setTimeout(() => {
      [rawInputPath, extractedAudioPath, originalSrtPath, myanmarSrtPath, finalVideoPath].forEach((f) => {
        if (fs.existsSync(f)) fs.unlink(f, () => {});
      });
    }, 2 * 60 * 60 * 1000);
  }
}

function getMainKeyboardMarkup() {
  return {
    inline_keyboard: [
      [{ text: '🎨 Translation Style', callback_data: 'settings_style' }, { text: '📱 Social Presets', callback_data: 'settings_presets' }],
      [{ text: '📊 Status', callback_data: 'menu_status' }]
    ]
  };
}

async function handleTelegramMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text ? message.text.trim() : '';

  if (!userSessions.has(userId)) userSessions.set(userId, { style: 'natural', preset: 'original' });
  const session = userSessions.get(userId);

  if (text === '/start' || text === '/menu') {
    return await sendTelegramMessage(chatId, `🇲🇲 <b>Myanmar Subtitle Studio Bot</b>\n\nဗီဒီယို သို့မဟုတ် အသံဖိုင် ပေးပို့လိုက်ပါ! စာတန်းထိုးထည့်ပေးပါမည်။`, getMainKeyboardMarkup());
  }

  if (message.video || (message.document && message.document.mime_type && message.document.mime_type.startsWith('video/'))) {
    const fileId = message.video ? message.video.file_id : message.document.file_id;
    const fileName = message.video ? (message.video.file_name || 'video.mp4') : message.document.file_name;
    processMediaJob({ chatId, fileId, fileName, isVideo: true, userStyle: session.style, userPreset: session.preset });
    return;
  }

  if (message.audio || message.voice || (message.document && message.document.mime_type && message.document.mime_type.startsWith('audio/'))) {
    const fileId = message.audio ? message.audio.file_id : (message.voice ? message.voice.file_id : message.document.file_id);
    const fileName = message.audio ? (message.audio.file_name || 'audio.mp3') : 'voice.ogg';
    processMediaJob({ chatId, fileId, fileName, isVideo: false, userStyle: session.style, userPreset: session.preset });
    return;
  }

  await sendTelegramMessage(chatId, `ဗီဒီယို (MP4) သို့မဟုတ် အသံဖိုင် (MP3) ပေးပို့ပေးပါခင်ဗျာ။`, getMainKeyboardMarkup());
}

app.post('/api/telegram/webhook', async (req, res) => {
  res.status(200).send('OK');
  const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (process.env.TELEGRAM_WEBHOOK_SECRET && incomingSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) return;
  if (req.body && req.body.message) await handleTelegramMessage(req.body.message);
});

app.get('/api/download/:fileName', (req, res) => {
  const filePath = path.join(TEMP_DIR, path.basename(req.params.fileName));
  if (!fs.existsSync(filePath)) return res.status(404).send('Expired');
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

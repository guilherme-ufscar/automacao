require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.WUZAPI_BASE_URL || 'http://wuzapi:8080';
const ADMIN_TOKEN = process.env.EVOLUTION_API_KEY || '';
const USER_TOKEN = process.env.WUZAPI_USER_TOKEN || '';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'karina';

const userHeaders = {
  Token: USER_TOKEN,
  'Content-Type': 'application/json',
};

const adminHeaders = {
  Authorization: ADMIN_TOKEN,
  'Content-Type': 'application/json',
};

async function createUser() {
  try {
    await axios.post(`${BASE_URL}/user/create`, {
      Name: INSTANCE,
      Token: USER_TOKEN,
    }, { headers: adminHeaders });
    console.log(`[WuzAPI] Usuário "${INSTANCE}" criado com sucesso`);
  } catch (err) {
    const msg = err.response?.data?.Error || err.message || '';
    if (err.response?.status === 409 || msg.toLowerCase().includes('already')) {
      console.log(`[WuzAPI] Usuário "${INSTANCE}" já existe`);
    } else {
      console.error('[WuzAPI] Erro ao criar usuário:', msg);
    }
  }
}

async function sendText(phone, text) {
  try {
    const res = await axios.post(`${BASE_URL}/chat/send/text`, {
      Phone: phone,
      Body: text,
    }, { headers: userHeaders });
    console.log('[WuzAPI] sendText OK:', JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    console.error('[WuzAPI] sendText ERRO:', err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}

async function sendAudio(phone, base64Audio) {
  try {
    const res = await axios.post(`${BASE_URL}/chat/send/audio`, {
      Phone: phone,
      Audio: `data:audio/mp3;base64,${base64Audio}`,
    }, { headers: userHeaders });
    console.log('[WuzAPI] sendAudio OK:', JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    console.error('[WuzAPI] sendAudio ERRO:', err.response?.status, JSON.stringify(err.response?.data));
    throw err;
  }
}

async function downloadMedia(messageId, audioMessage) {
  const res = await axios.post(`${BASE_URL}/chat/downloadaudio`, {
    Url: audioMessage.url,
    MediaKey: audioMessage.mediaKey,
    Mimetype: audioMessage.mimetype || 'audio/ogg; codecs=opus',
    FileSHA256: audioMessage.fileSha256,
    FileLength: audioMessage.fileLength,
  }, { headers: userHeaders });
  return res.data.Base64;
}

module.exports = { createUser, sendText, sendAudio, downloadMedia };

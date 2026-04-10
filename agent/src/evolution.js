require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.EVOLUTION_BASE_URL || 'http://evolution:8080';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'karina';
const API_KEY = process.env.EVOLUTION_API_KEY || '';

const headers = {
  apikey: API_KEY,
  'Content-Type': 'application/json',
};

async function sendText(phone, text) {
  const url = `${BASE_URL}/message/sendText/${INSTANCE}`;
  const res = await axios.post(url, { number: phone, text }, { headers });
  return res.data;
}

async function sendAudio(phone, base64Audio) {
  const url = `${BASE_URL}/message/sendMedia/${INSTANCE}`;
  const res = await axios.post(url, {
    number: phone,
    mediatype: 'audio',
    media: base64Audio,
    fileName: 'audio.ogg',
    mimetype: 'audio/ogg; codecs=opus',
  }, { headers });
  return res.data;
}

async function downloadMedia(messageId) {
  const url = `${BASE_URL}/chat/getBase64FromMediaMessage/${INSTANCE}`;
  const res = await axios.post(url, {
    message: { key: { id: messageId } },
  }, { headers });
  return res.data.base64;
}

module.exports = { sendText, sendAudio, downloadMedia };

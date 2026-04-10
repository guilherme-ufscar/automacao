require('dotenv').config();
const OpenAI = require('openai');
const { Readable } = require('stream');
const db = require('./db');
const prompts = require('./prompts');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function chat(phone, userMessage) {
  const history = await db.getLastMessages(phone, 10); // MAX 10 — nunca alterar
  const lead = await db.getLead(phone);
  const segment = lead ? lead.segment : 'desconhecido';
  const systemPrompt = prompts.getPrompt(segment);

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // nunca trocar para outro modelo
    max_tokens: 350,       // fixo — nunca alterar
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ],
  });

  return res.choices[0].message.content;
}

async function transcribe(audioBuffer) {
  const file = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'pt',
  });

  return transcription.text;
}

async function textToSpeech(text) {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: text,
    response_format: 'opus',
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

module.exports = { chat, transcribe, textToSpeech };

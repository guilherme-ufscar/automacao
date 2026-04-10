const db = require('./db');
const ai = require('./ai');
const evolution = require('./evolution');

async function handle({ phone, text, isAudio, messageId }) {
  try {
    let userMessage = text;
    let clienteSentAudio = false;

    // 1. Se for áudio, transcrever
    if (isAudio) {
      const base64 = await evolution.downloadMedia(messageId);
      const audioBuffer = Buffer.from(base64, 'base64');
      userMessage = await ai.transcribe(audioBuffer);
      clienteSentAudio = true;
    }

    if (!userMessage || userMessage.trim() === '') {
      return;
    }

    // 2. Garantir que o lead existe
    let lead = await db.getLead(phone);
    if (!lead) {
      lead = await db.upsertLead(phone, { segment: 'desconhecido', status: 'novo' });
    }

    // 3. Gerar resposta via IA
    let reply = await ai.chat(phone, userMessage);

    // 4. Se segmento desconhecido, verificar se IA retornou JSON de classificação
    if (lead.segment === 'desconhecido') {
      const jsonMatch = reply.match(/\{[\s\S]*"segment"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.segment && parsed.reply) {
            await db.updateLeadSegment(phone, parsed.segment);
            reply = parsed.reply;
          }
        } catch (e) {
          // não é JSON válido, usa reply direto
        }
      }
    }

    // 5. Extrair e atualizar status se [STATUS:xxx] presente
    const statusMatch = reply.match(/\[STATUS:(quente|morno|frio)\]/i);
    if (statusMatch) {
      const status = statusMatch[1].toLowerCase();
      await db.updateLeadStatus(phone, status);
      reply = reply.replace(/\[STATUS:(quente|morno|frio)\]/gi, '').trim();
    }

    // 6. Salvar mensagens
    await db.saveMessage(phone, 'user', userMessage, clienteSentAudio ? 'audio' : 'text');
    await db.saveMessage(phone, 'assistant', reply, clienteSentAudio ? 'audio' : 'text');

    // 7. Enviar resposta
    if (clienteSentAudio) {
      const base64Audio = await ai.textToSpeech(reply);
      await evolution.sendAudio(phone, base64Audio);
    } else {
      await evolution.sendText(phone, reply);
    }
  } catch (err) {
    console.error('[Router] Erro ao processar mensagem:', err.message);
  }
}

module.exports = { handle };

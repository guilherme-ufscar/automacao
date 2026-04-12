const db = require('./db');
const ai = require('./ai');
const evolution = require('./evolution');

async function handle({ phone, text, isAudio, isImage, messageId, rawAudioMessage, rawImageMessage, audioBase64 }) {
  console.log(`[Router] Mensagem de ${phone} | áudio=${isAudio} | imagem=${isImage} | texto="${text}"`);
  try {
    let userMessage = text;
    let clienteSentAudio = false;

    // 1. Se for áudio, transcrever
    if (isAudio) {
      // WuzAPI envia base64 direto no webhook — usa ele; só faz download se não vier
      const b64 = audioBase64 || await evolution.downloadMedia(messageId, rawAudioMessage);
      const audioBuffer = Buffer.from(b64, 'base64');
      userMessage = await ai.transcribe(audioBuffer);
      console.log(`[Router] Áudio transcrito: "${userMessage}"`);
      clienteSentAudio = true;
    }

    // 1b. Se for imagem, descrever com vision
    if (isImage && rawImageMessage) {
      try {
        const imgData = await evolution.downloadImage(rawImageMessage);
        const caption = text || '';
        const description = await ai.describeImage(imgData.Data, caption);
        userMessage = caption
          ? `[Imagem enviada com legenda: "${caption}"]\nDescrição da imagem: ${description}`
          : `[Imagem enviada]\nDescrição da imagem: ${description}`;
        console.log(`[Router] Imagem descrita: "${description.slice(0, 60)}..."`);
      } catch (imgErr) {
        console.error('[Router] Falha ao processar imagem:', imgErr.message);
        userMessage = text || '[Imagem recebida, mas não foi possível processá-la]';
      }
    }

    if (!userMessage || userMessage.trim() === '') {
      // Mídia não suportada (imagem, vídeo, sticker…)
      await evolution.sendText(phone, 'Olá! 😊 Consigo responder mensagens de texto e áudio. Pode me enviar sua dúvida por texto ou áudio!');
      return;
    }

    // 2. Garantir que o lead existe
    console.log(`[Router] Buscando lead ${phone}...`);
    let lead = await db.getLead(phone);
    if (!lead) {
      lead = await db.upsertLead(phone, { segment: 'desconhecido', status: 'novo' });
    }
    console.log(`[Router] Lead: segment=${lead.segment} status=${lead.status}`);

    // 3. Gerar resposta via IA
    // Injeta nome do lead na mensagem de contexto se disponível
    const contextMessage = lead.name
      ? `[Contexto: o nome do cliente é ${lead.name}]\n${userMessage}`
      : userMessage;
    console.log(`[Router] Chamando OpenAI...`);
    let reply = await ai.chat(phone, contextMessage);
    console.log(`[Router] OpenAI respondeu: "${reply.slice(0, 60)}..."`);

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

    // 5. Extrair nome se [NOME:xxx] presente
    const nomeMatch = reply.match(/\[NOME:([^\]]+)\]/i);
    if (nomeMatch) {
      const nome = nomeMatch[1].trim();
      await db.upsertLead(phone, { name: nome });
      lead.name = nome;
      reply = reply.replace(/\[NOME:[^\]]+\]/gi, '').trim();
      console.log(`[Router] Nome do cliente salvo: "${nome}"`);
    }

    // Extrair e atualizar status se [STATUS:xxx] presente
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
      try {
        const base64Audio = await ai.textToSpeech(reply);
        await evolution.sendAudio(phone, base64Audio);
        console.log(`[Router] Resposta em áudio enviada para ${phone}`);
      } catch (audioErr) {
        console.error('[Router] Falha no áudio, enviando texto:', audioErr.message);
        await evolution.sendText(phone, reply);
      }
    } else {
      await evolution.sendText(phone, reply);
      console.log(`[Router] Resposta enviada para ${phone}: "${reply.slice(0, 80)}"`);;
    }
  } catch (err) {
    console.error('[Router] Erro ao processar mensagem:', err.message, err.response?.data);
  }
}

module.exports = { handle };

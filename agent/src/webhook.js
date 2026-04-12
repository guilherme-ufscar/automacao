function parse(body) {
  if (body.type !== 'Message') return null;

  const event = body.event;
  if (!event) return null;

  const { Info, Message } = event;
  if (!Info || !Message) return null;

  // Ignorar mensagens enviadas pelo próprio bot
  if (Info.IsFromMe === true || Info.FromMe === true) return null;

  // Ignorar grupos
  const chat = Info.Chat || Info.Sender || '';
  if (chat.includes('@g.us')) return null;

  // SenderAlt tem o número real (ex: 5519989261165@s.whatsapp.net)
  // Sender pode usar @lid (novo formato interno do WhatsApp)
  const senderRaw = Info.SenderAlt || Info.Sender || '';
  if (!senderRaw) return null;

  // Remove @suffix e :device-index (ex: 5519999999:6@s.whatsapp.net → 5519999999)
  const phone = senderRaw.replace(/@.*/, '').replace(/:.*/, '');
  const isAudio = Info.Type === 'audio' || Info.MediaType === 'ptt' || !!Message.audioMessage;
  const text = Message.conversation || Message.extendedTextMessage?.text || '';
  const messageId = Info.ID;
  const rawAudioMessage = Message.audioMessage || null;
  // WuzAPI envia base64 do áudio direto no corpo do webhook
  const audioBase64 = body.base64 || null;

  return { phone, text, isAudio, messageId, rawAudioMessage, audioBase64 };
}

module.exports = { parse };

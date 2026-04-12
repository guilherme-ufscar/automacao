function parse(body) {
  // WuzAPI envia type "Message" para mensagens recebidas
  if (body.type !== 'Message') return null;

  const event = body.event;
  if (!event) return null;

  const { Info, Message } = event;
  if (!Info || !Message) return null;

  // Ignorar mensagens enviadas pelo próprio bot
  if (Info.FromMe === true) return null;

  const sender = Info.Sender || '';
  if (!sender) return null;

  // Ignorar grupos
  if (sender.includes('@g.us')) return null;

  const phone = sender.replace(/@.*/, '');
  const isAudio = Info.Type === 'audio' || !!Message.audioMessage;
  const text = Message.conversation || Message.extendedTextMessage?.text || '';
  const messageId = Info.ID;
  const rawAudioMessage = Message.audioMessage || null;

  return { phone, text, isAudio, messageId, rawAudioMessage };
}

module.exports = { parse };

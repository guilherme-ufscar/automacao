function parse(body) {
  // Ignorar eventos que não sejam messages.upsert
  if (body.event !== 'messages.upsert') return null;

  const data = body.data;
  if (!data) return null;

  // Ignorar mensagens enviadas pelo próprio bot
  if (data.key && data.key.fromMe === true) return null;

  // Ignorar se não há mensagem
  if (!data.message) return null;

  const remoteJid = data.key && data.key.remoteJid;
  if (!remoteJid) return null;

  // Ignorar grupos
  if (remoteJid.includes('@g.us')) return null;

  // Extrair phone (remover sufixo @s.whatsapp.net)
  const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');

  const messageType = data.messageType || '';
  const message = data.message || {};

  const isAudio = messageType === 'audioMessage';
  const text = message.conversation || (message.extendedTextMessage && message.extendedTextMessage.text) || '';
  const messageId = data.key && data.key.id;

  return { phone, text, isAudio, messageId };
}

module.exports = { parse };

const express = require('express');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const ai = require('./ai');
const webhook = require('./webhook');
const router = require('./router');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Serve o painel CRM unificado
// Em dev: ../../crm/public | Em container: /app/crm/public (copiado pelo Dockerfile)
const CRM_PUBLIC = process.env.CRM_PUBLIC_PATH || path.join(__dirname, '..', '..', 'crm', 'public');
app.use(express.static(CRM_PUBLIC));

// ── AUTH ───────────────────────────────────────────────────
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'alcantara2024';
const VALID_TOKEN = Buffer.from(CRM_PASSWORD + ':crm').toString('base64');

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === CRM_PASSWORD) return res.json({ token: VALID_TOKEN });
  res.status(401).json({ error: 'Senha incorreta' });
});

function auth(req, res, next) {
  if (req.path === '/login') return next();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token === VALID_TOKEN) return next();
  res.status(401).json({ error: 'Não autorizado' });
}
app.use('/api', auth);

// ── WEBHOOK ────────────────────────────────────────────────
const processedIds = new Map();
const DEDUP_TTL_MS = 30_000;

function isDuplicate(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  for (const [id, ts] of processedIds) {
    if (now - ts > DEDUP_TTL_MS) processedIds.delete(id);
  }
  if (processedIds.has(messageId)) return true;
  processedIds.set(messageId, now);
  return false;
}

app.get('/webhook', (req, res) => res.status(200).send('OK'));

app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');
  console.log('[Webhook] RAW:', JSON.stringify(req.body));
  const parsed = webhook.parse(req.body);
  if (!parsed) { console.log('[Webhook] parse retornou null — ignorado'); return; }
  if (isDuplicate(parsed.messageId)) { console.log(`[Webhook] Duplicata ignorada: ${parsed.messageId}`); return; }
  router.handle(parsed).catch(err => console.error('[Webhook] Erro no handler:', err.message));
});

// ── DASHBOARD ──────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const stats = await db.getStats();
    const { rows: recent } = await db.pool.query(`
      SELECT l.*,
        (SELECT content FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message_at
      FROM leads l ORDER BY l.updated_at DESC LIMIT 10
    `);
    const { rows: upcoming } = await db.pool.query(
      `SELECT * FROM leads WHERE scheduled_at >= NOW() ORDER BY scheduled_at ASC LIMIT 5`
    );
    const { rows: todayRow } = await db.pool.query(
      `SELECT COUNT(*) FROM leads WHERE created_at >= CURRENT_DATE`
    );
    res.json({
      total: stats.total,
      today: parseInt(todayRow[0].count),
      byStatus: stats.porStatus,
      bySegment: stats.porSegmento,
      recent,
      upcoming,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LEADS ──────────────────────────────────────────────────
app.get('/api/leads', async (req, res) => {
  try {
    const { status, segment, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = []; const params = [];
    if (status) { params.push(status); where.push(`l.status = $${params.length}`); }
    if (segment) { params.push(segment); where.push(`l.segment = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(l.name ILIKE $${params.length} OR l.phone ILIKE $${params.length})`); }
    const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [leads, count] = await Promise.all([
      db.pool.query(`
        SELECT l.*,
          (SELECT content FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM leads l ${wc} ORDER BY l.updated_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limit, offset]),
      db.pool.query(`SELECT COUNT(*) FROM leads l ${wc}`, params),
    ]);
    res.json({ leads: leads.rows, total: parseInt(count.rows[0].count), page: parseInt(page), pages: Math.ceil(parseInt(count.rows[0].count) / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leads/:phone', async (req, res) => {
  try {
    const { rows: leadRows } = await db.pool.query('SELECT * FROM leads WHERE phone = $1', [req.params.phone]);
    if (!leadRows[0]) return res.status(404).json({ error: 'Lead não encontrado' });
    const { rows: messages } = await db.pool.query('SELECT * FROM messages WHERE phone = $1 ORDER BY created_at ASC', [req.params.phone]);
    res.json({ lead: leadRows[0], messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/leads/:phone', async (req, res) => {
  try {
    const fields = []; const params = [];
    for (const [k, v] of Object.entries(req.body)) {
      params.push(v === undefined ? null : v);
      fields.push(`${k} = $${params.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.phone);
    const { rows } = await db.pool.query(`UPDATE leads SET ${fields.join(', ')} WHERE phone = $${params.length} RETURNING *`, params);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HUMAN TAKEOVER ─────────────────────────────────────────
app.post('/api/leads/:phone/takeover', async (req, res) => {
  try {
    const { active } = req.body; // true = humano assume | false = devolve para IA
    await db.setHumanTakeover(req.params.phone, !!active);
    res.json({ success: true, human_takeover: !!active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEND MESSAGE ───────────────────────────────────────────
app.post('/api/leads/:phone/send', async (req, res) => {
  try {
    const { phone } = req.params;
    const { message } = req.body;
    await axios.post(
      `${process.env.WUZAPI_BASE_URL || 'http://wuzapi:8080'}/chat/send/text`,
      { Phone: phone, Body: message },
      { headers: { Token: process.env.WUZAPI_USER_TOKEN || '', 'Content-Type': 'application/json' } }
    );
    await db.saveMessage(phone, 'assistant', message, 'text');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SUMMARIZE ──────────────────────────────────────────────
app.post('/api/leads/:phone/summarize', async (req, res) => {
  try {
    const { rows: messages } = await db.pool.query(
      'SELECT role, content FROM messages WHERE phone = $1 ORDER BY created_at ASC',
      [req.params.phone]
    );
    if (!messages.length) return res.json({ summary: 'Nenhuma mensagem encontrada para resumir.' });
    const summary = await ai.summarize(messages);
    res.json({ summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AGENDAMENTOS ───────────────────────────────────────────
app.get('/api/agendamentos', async (req, res) => {
  try {
    const { rows } = await db.pool.query(`SELECT * FROM leads WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STATS (compatibilidade com painel antigo) ──────────────
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AGENT CONFIG ───────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const { rows } = await db.pool.query('SELECT key, value, updated_at FROM agent_config ORDER BY key');
    const config = {};
    rows.forEach(r => { config[r.key] = { value: r.value, updated_at: r.updated_at }; });
    res.json(config);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    if (value === null || value === '') {
      await db.pool.query('DELETE FROM agent_config WHERE key = $1', [key]);
    } else {
      await db.pool.query(`
        INSERT INTO agent_config (key, value, updated_at) VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, [key, value]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(CRM_PUBLIC, 'index.html'));
});

module.exports = app;

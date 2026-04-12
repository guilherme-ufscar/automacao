require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'alcantara',
  user: process.env.POSTGRES_USER || 'alcantara',
  password: process.env.POSTGRES_PASSWORD || 'senha_segura_aqui',
});

const CRM_PASSWORD = process.env.CRM_PASSWORD || 'alcantara2024';
const VALID_TOKEN = Buffer.from(CRM_PASSWORD + ':crm').toString('base64');

async function initDB() {
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to TEXT;
    CREATE TABLE IF NOT EXISTS agent_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[CRM] DB pronto');
}

// ── AUTH ───────────────────────────────────────────────────
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

// ── DASHBOARD ──────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const [stats, todayCount, segments, recent, upcoming] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) FROM leads GROUP BY status`),
      pool.query(`SELECT COUNT(*) FROM leads WHERE created_at >= CURRENT_DATE`),
      pool.query(`SELECT segment, COUNT(*) FROM leads GROUP BY segment`),
      pool.query(`
        SELECT l.*,
          (SELECT content FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM leads l ORDER BY l.updated_at DESC LIMIT 10
      `),
      pool.query(`SELECT * FROM leads WHERE scheduled_at >= NOW() ORDER BY scheduled_at ASC LIMIT 5`),
    ]);
    const byStatus = {}; stats.rows.forEach(r => { byStatus[r.status] = parseInt(r.count); });
    const bySegment = {}; segments.rows.forEach(r => { bySegment[r.segment] = parseInt(r.count); });
    res.json({
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      today: parseInt(todayCount.rows[0].count),
      byStatus, bySegment,
      recent: recent.rows,
      upcoming: upcoming.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LEADS LIST ─────────────────────────────────────────────
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
      pool.query(`
        SELECT l.*,
          (SELECT content FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages WHERE phone = l.phone ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM leads l ${wc} ORDER BY l.updated_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM leads l ${wc}`, params),
    ]);
    res.json({ leads: leads.rows, total: parseInt(count.rows[0].count), page: parseInt(page), pages: Math.ceil(parseInt(count.rows[0].count) / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LEAD DETAIL ────────────────────────────────────────────
app.get('/api/leads/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const [lead, messages] = await Promise.all([
      pool.query('SELECT * FROM leads WHERE phone = $1', [phone]),
      pool.query('SELECT * FROM messages WHERE phone = $1 ORDER BY created_at ASC', [phone]),
    ]);
    if (!lead.rows[0]) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead: lead.rows[0], messages: messages.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── UPDATE LEAD ────────────────────────────────────────────
app.put('/api/leads/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const fields = []; const params = [];
    for (const [k, v] of Object.entries(req.body)) {
      params.push(v === undefined ? null : v);
      fields.push(`${k} = $${params.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    fields.push(`updated_at = NOW()`);
    params.push(phone);
    const { rows } = await pool.query(`UPDATE leads SET ${fields.join(', ')} WHERE phone = $${params.length} RETURNING *`, params);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SEND MESSAGE ───────────────────────────────────────────
app.post('/api/leads/:phone/send', async (req, res) => {
  try {
    const { phone } = req.params;
    const { message } = req.body;
    await axios.post(`${process.env.WUZAPI_BASE_URL || 'http://wuzapi:8080'}/chat/send/text`,
      { Phone: phone, Body: message },
      { headers: { Token: process.env.WUZAPI_USER_TOKEN || '', 'Content-Type': 'application/json' } }
    );
    await pool.query('INSERT INTO messages (phone, role, content, media_type) VALUES ($1, $2, $3, $4)', [phone, 'assistant', message, 'text']);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AGENDAMENTOS ───────────────────────────────────────────
app.get('/api/agendamentos', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM leads WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AGENT CONFIG ───────────────────────────────────────────
app.get('/api/config', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value, updated_at FROM agent_config ORDER BY key');
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
      await pool.query('DELETE FROM agent_config WHERE key = $1', [key]);
    } else {
      await pool.query(`
        INSERT INTO agent_config (key, value, updated_at) VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, [key, value]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

initDB().then(() => {
  const PORT = process.env.PORT || 7919;
  app.listen(PORT, () => console.log(`[CRM] Painel rodando na porta ${PORT}`));
}).catch(e => { console.error('[CRM] Erro ao iniciar:', e.message); process.exit(1); });

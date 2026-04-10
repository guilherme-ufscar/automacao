require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'alcantara',
  user: process.env.POSTGRES_USER || 'alcantara',
  password: process.env.POSTGRES_PASSWORD || 'senha_segura_aqui',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'novo',
      segment TEXT DEFAULT 'desconhecido',
      renda TEXT,
      nome_limpo TEXT,
      fgts TEXT,
      primeiro_imovel TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      media_type TEXT DEFAULT 'text',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_segment ON leads(segment);
  `);
  console.log('[DB] Tabelas inicializadas');
}

async function getLead(phone) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE phone = $1', [phone]);
  return rows[0] || null;
}

async function upsertLead(phone, data = {}) {
  const fields = ['phone', 'name', 'status', 'segment', 'renda', 'nome_limpo', 'fgts', 'primeiro_imovel'];
  const values = [phone, data.name, data.status || 'novo', data.segment || 'desconhecido',
    data.renda, data.nome_limpo, data.fgts, data.primeiro_imovel];

  await pool.query(`
    INSERT INTO leads (phone, name, status, segment, renda, nome_limpo, fgts, primeiro_imovel)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (phone) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, leads.name),
      status = COALESCE(EXCLUDED.status, leads.status),
      segment = COALESCE(EXCLUDED.segment, leads.segment),
      renda = COALESCE(EXCLUDED.renda, leads.renda),
      nome_limpo = COALESCE(EXCLUDED.nome_limpo, leads.nome_limpo),
      fgts = COALESCE(EXCLUDED.fgts, leads.fgts),
      primeiro_imovel = COALESCE(EXCLUDED.primeiro_imovel, leads.primeiro_imovel),
      updated_at = NOW()
  `, values);

  return getLead(phone);
}

async function updateLeadStatus(phone, status) {
  await pool.query(
    'UPDATE leads SET status = $1, updated_at = NOW() WHERE phone = $2',
    [status, phone]
  );
}

async function updateLeadSegment(phone, segment) {
  await pool.query(
    'UPDATE leads SET segment = $1, updated_at = NOW() WHERE phone = $2',
    [segment, phone]
  );
}

async function saveMessage(phone, role, content, mediaType = 'text') {
  await pool.query(
    'INSERT INTO messages (phone, role, content, media_type) VALUES ($1, $2, $3, $4)',
    [phone, role, content, mediaType]
  );
}

async function getLastMessages(phone, limit = 10) {
  const { rows } = await pool.query(`
    SELECT role, content FROM (
      SELECT role, content, created_at
      FROM messages
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT $2
    ) sub
    ORDER BY created_at ASC
  `, [phone, limit]);
  return rows;
}

async function getAllLeads(filters = {}) {
  let query = 'SELECT * FROM leads WHERE 1=1';
  const values = [];
  let idx = 1;

  if (filters.status) {
    query += ` AND status = $${idx++}`;
    values.push(filters.status);
  }
  if (filters.segment) {
    query += ` AND segment = $${idx++}`;
    values.push(filters.segment);
  }

  const limit = parseInt(filters.limit || 20);
  const page = parseInt(filters.page || 1);
  const offset = (page - 1) * limit;

  query += ` ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  values.push(limit, offset);

  const { rows } = await pool.query(query, values);
  return rows;
}

async function getLeadWithHistory(phone) {
  const lead = await getLead(phone);
  if (!lead) return null;

  const { rows: messages } = await pool.query(
    'SELECT * FROM messages WHERE phone = $1 ORDER BY created_at ASC',
    [phone]
  );

  return { ...lead, messages };
}

async function getStats() {
  const { rows: statusRows } = await pool.query(`
    SELECT status, COUNT(*) as count FROM leads GROUP BY status
  `);
  const { rows: segmentRows } = await pool.query(`
    SELECT segment, COUNT(*) as count FROM leads GROUP BY segment
  `);
  const { rows: totalRow } = await pool.query('SELECT COUNT(*) as count FROM leads');

  const porStatus = {};
  statusRows.forEach(r => { porStatus[r.status] = parseInt(r.count); });

  const porSegmento = {};
  segmentRows.forEach(r => { porSegmento[r.segment] = parseInt(r.count); });

  return {
    total: parseInt(totalRow[0].count),
    porStatus,
    porSegmento,
  };
}

module.exports = {
  pool,
  initDB,
  getLead,
  upsertLead,
  updateLeadStatus,
  updateLeadSegment,
  saveMessage,
  getLastMessages,
  getAllLeads,
  getLeadWithHistory,
  getStats,
};

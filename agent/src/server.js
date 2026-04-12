const express = require('express');
const path = require('path');
const db = require('./db');
const webhook = require('./webhook');
const router = require('./router');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check para Evolution API
app.get('/webhook', (req, res) => {
  res.status(200).send('OK');
});

// Receber eventos do WhatsApp
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK'); // responde rápido para não dar timeout

  console.log('[Webhook] RAW:', JSON.stringify(req.body));

  const parsed = webhook.parse(req.body);
  if (!parsed) {
    console.log('[Webhook] parse retornou null — ignorado');
    return;
  }

  router.handle(parsed).catch(err => {
    console.error('[Webhook] Erro no handler:', err.message);
  });
});

// Listar leads com filtros e paginação
app.get('/api/leads', async (req, res) => {
  try {
    const { status, segment, page, limit } = req.query;
    const leads = await db.getAllLeads({ status, segment, page, limit });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar lead + histórico completo
app.get('/api/leads/:phone', async (req, res) => {
  try {
    const lead = await db.getLeadWithHistory(req.params.phone);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar status manualmente
app.put('/api/leads/:phone', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Campo status obrigatório' });
    await db.updateLeadStatus(req.params.phone, status);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estatísticas
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Servir painel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;

require('dotenv').config();
const db = require('./db');
const app = require('./server');
const evolution = require('./evolution');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    await db.initDB();
    await evolution.createUser();
    app.listen(PORT, () => {
      console.log(`[Agent] Karina rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error('[Agent] Falha ao iniciar:', err.message);
    process.exit(1);
  }
}

main();

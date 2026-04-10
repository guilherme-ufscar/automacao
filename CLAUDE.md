# CLAUDE.md — Agente IA WhatsApp (Alcântara Negócios Imobiliários)

## ⚠️ INSTRUÇÕES PARA O AGENTE

Você é um agente full stack sênior. Implemente TUDO de uma vez por fase, sem pedir confirmação a cada arquivo. Este documento é a única fonte da verdade. Não explique o que vai fazer — apenas faça. Só pergunte se houver ambiguidade crítica de negócio. Ao final de cada fase, informe o que foi criado em uma linha só.

---

## 🎯 OBJETIVO DO PROJETO

Criar um **agente de IA para WhatsApp** que atua como assistente imobiliária chamada **Karina**, da **Alcântara Negócios Imobiliários**.

O agente deve:
- Receber mensagens via **Evolution API** (webhook)
- Responder mensagens de texto e áudio (transcrever + responder)
- Gerar respostas em áudio quando o cliente enviar áudio
- Conduzir triagem de leads: Minha Casa Minha Vida, Leilão, Regularização
- Classificar leads automaticamente: quente 🟢 / morno 🟡 / frio 🔴
- Armazenar histórico por número de WhatsApp no PostgreSQL
- Expor painel web simples para visualizar leads e conversas

---

## 🧱 STACK TÉCNICA

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20 Alpine |
| WhatsApp | Evolution API v2 (via webhook HTTP) |
| IA texto | OpenAI `gpt-4o-mini` |
| IA voz → texto | OpenAI `whisper-1` |
| IA texto → voz | OpenAI `tts-1` |
| Banco de dados | PostgreSQL 16 |
| Driver DB | `pg` (node-postgres, sem ORM pesado) |
| Backend | Express.js |
| Frontend painel | HTML + Vanilla JS (sem framework) |
| Infraestrutura | Docker Compose (tudo junto) |
| Variáveis | `dotenv` |

---

## 📁 ESTRUTURA DE PASTAS

```
/
├── agent/
│   ├── src/
│   │   ├── index.js          # Entry point (inicia Express + init DB)
│   │   ├── webhook.js        # Parse e validação dos eventos da Evolution API
│   │   ├── ai.js             # OpenAI: chat, whisper, tts
│   │   ├── db.js             # PostgreSQL: pool + init tabelas + queries
│   │   ├── router.js         # Lógica de roteamento de mensagens
│   │   ├── prompts.js        # Todos os system prompts centralizados
│   │   ├── evolution.js      # Cliente HTTP para Evolution API
│   │   └── server.js         # Express: rotas API REST + serve painel
│   ├── public/
│   │   └── index.html        # Painel de leads (HTML puro)
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── docker-compose.yml
└── README.md
```

---

## 🐳 DOCKER COMPOSE (docker-compose.yml)

Subir **3 serviços** na mesma network interna `alcantara_net`:

### Serviço `postgres`
- Imagem: `postgres:16-alpine`
- Porta exposta: `5432:5432`
- Volume persistente: `postgres_data:/var/lib/postgresql/data`
- Env: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Healthcheck: `pg_isready -U ${POSTGRES_USER}`

### Serviço `evolution`
- Imagem: `atendai/evolution-api:latest`
- Porta exposta: `8080:8080`
- Depende de: `postgres` condition `service_healthy`
- Variáveis obrigatórias:
  ```
  SERVER_URL=http://evolution:8080
  AUTHENTICATION_TYPE=apikey
  AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}
  DATABASE_ENABLED=true
  DATABASE_PROVIDER=postgresql
  DATABASE_CONNECTION_URI=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
  WEBHOOK_GLOBAL_ENABLED=true
  WEBHOOK_GLOBAL_URL=http://agent:3000/webhook
  WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false
  DEL_INSTANCE=false
  ```
- Volume: `evolution_data:/evolution/instances`

### Serviço `agent`
- Build: `./agent`
- Porta exposta: `3000:3000`
- Depende de: `postgres` (healthy) + `evolution`
- Env: todas as variáveis via `.env` na raiz
- Restart: `unless-stopped`

### Volumes nomeados: `postgres_data`, `evolution_data`
### Network: `alcantara_net` bridge

---

## ⚙️ VARIÁVEIS DE AMBIENTE (agent/.env.example)

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Evolution API
EVOLUTION_API_KEY=sua-chave-aqui
EVOLUTION_BASE_URL=http://evolution:8080
EVOLUTION_INSTANCE=karina

# PostgreSQL
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=alcantara
POSTGRES_USER=alcantara
POSTGRES_PASSWORD=senha_segura_aqui

# App
PORT=3000
NODE_ENV=production
```

---

## 🗃️ BANCO DE DADOS (PostgreSQL)

Init automático no `db.js` via `CREATE TABLE IF NOT EXISTS` ao subir o serviço.

```sql
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'novo',            -- novo | quente | morno | frio
  segment TEXT DEFAULT 'desconhecido',   -- mcmv | leilao | regularizacao | desconhecido
  renda TEXT,
  nome_limpo TEXT,                       -- sim | nao | nao_informado
  fgts TEXT,                             -- sim | nao | nao_informado
  primeiro_imovel TEXT,                  -- sim | nao | nao_informado
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,                    -- user | assistant
  content TEXT NOT NULL,
  media_type TEXT DEFAULT 'text',        -- text | audio
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_segment ON leads(segment);
```

### Queries necessárias em `db.js`:
- `getLead(phone)` — busca lead ou retorna null
- `upsertLead(phone, data)` — cria ou atualiza
- `updateLeadStatus(phone, status)` — atualiza status
- `updateLeadSegment(phone, segment)` — atualiza segmento
- `saveMessage(phone, role, content, mediaType)` — salva mensagem
- `getLastMessages(phone, limit=10)` — retorna últimas N mensagens no formato `[{role, content}]`
- `getAllLeads(filters)` — lista com filtros opcionais (status, segment)
- `getLeadWithHistory(phone)` — lead + todas as mensagens

---

## 📲 EVOLUTION API — CLIENTE (agent/src/evolution.js)

Headers em toda request: `{ apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' }`

```js
// Enviar texto
// POST {EVOLUTION_BASE_URL}/message/sendText/{EVOLUTION_INSTANCE}
// body: { number: phone, text: text }
sendText(phone, text)

// Enviar áudio (base64 ogg/opus)
// POST {EVOLUTION_BASE_URL}/message/sendMedia/{EVOLUTION_INSTANCE}
// body: { number: phone, mediatype: "audio", media: base64, fileName: "audio.ogg", mimetype: "audio/ogg; codecs=opus" }
sendAudio(phone, base64Audio)

// Baixar mídia recebida
// POST {EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/{EVOLUTION_INSTANCE}
// body: { message: { key: { id: messageId } } }
// retorna: { base64: "..." }
downloadMedia(messageId)
```

---

## 📥 WEBHOOK — PARSE (agent/src/webhook.js)

A Evolution API envia `POST /webhook` com body:

```json
{
  "event": "messages.upsert",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "MSG_ID_AQUI"
    },
    "message": {
      "conversation": "texto da mensagem",
      "audioMessage": {}
    },
    "messageType": "conversation"
  }
}
```

**Regras de parse:**
- Ignorar se `event !== "messages.upsert"`
- Ignorar se `data.key.fromMe === true`
- Ignorar se `data.data.message` for nulo
- `phone` = `data.key.remoteJid` removendo `@s.whatsapp.net` e `@g.us` (ignorar grupos)
- `isAudio` = `messageType === "audioMessage"`
- `text` = `message.conversation || message.extendedTextMessage?.text || ""`
- `messageId` = `data.key.id`

---

## 🤖 IA (agent/src/ai.js)

### ⚠️ Regras de economia de tokens — NUNCA VIOLAR

| Regra | Valor |
|---|---|
| Histórico máximo | 10 mensagens |
| max_tokens | 350 |
| Modelo | gpt-4o-mini |
| TTS | Apenas se cliente enviou áudio |
| Temperature | 0.7 |

```js
// chat — padrão obrigatório
async function chat(phone, userMessage) {
  const history = await db.getLastMessages(phone, 10); // MAX 10
  const lead = await db.getLead(phone);
  const systemPrompt = prompts.getPrompt(lead.segment);

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 350,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ]
  });

  return res.choices[0].message.content;
}

// transcribe — áudio Buffer → texto
async function transcribe(audioBuffer) {
  // Criar File a partir do buffer (formato webm/ogg)
  // Enviar para whisper-1
  // Retornar texto transcrito
}

// textToSpeech — texto → base64 ogg/opus
async function textToSpeech(text) {
  // Modelo: tts-1, voz: 'nova', formato: 'opus'
  // Retornar buffer convertido para base64
}
```

---

## 💬 PROMPTS (agent/src/prompts.js)

Exportar `getPrompt(segment)` retornando string. Segmentos: `desconhecido`, `mcmv`, `leilao`, `regularizacao`.

### BASE (incluído em todos os prompts abaixo):
```
Você é Karina, assistente da Alcântara Negócios Imobiliários.
Fale de forma natural como WhatsApp. Respostas curtas e diretas (máximo 5 linhas).
Faça uma pergunta por vez. Sem linguagem jurídica.
Nunca encerre sem dar próximo passo ao cliente.
Destaque sempre benefícios. Gere leve urgência.
Diferencial: assessoria jurídica completa no processo.
```

### Prompt `desconhecido`:
```
[BASE]
Identifique o interesse do cliente de forma natural.
Descubra se ele busca: (1) financiamento Minha Casa Minha Vida, (2) imóvel de leilão, ou (3) regularização de imóvel.
Quando identificar com certeza, responda SOMENTE em JSON (sem mais nada):
{"segment":"mcmv|leilao|regularizacao","reply":"sua mensagem aqui"}
Antes de identificar, converse normalmente.
```

### Prompt `mcmv`:
```
[BASE]
Especialidade: Minha Casa Minha Vida.
Triagem (uma pergunta por vez): renda mensal → nome limpo ou sujo → tem FGTS → primeiro imóvel.
Classificação:
- QUENTE: renda ok + nome limpo + primeiro imóvel → oferecer simulação gratuita
- MORNO: renda informal ou restrição leve → análise detalhada
- FRIO: sem renda ou muito negativado → orientar caminho futuro
Gatilhos: subsídio até R$55 mil, FGTS na entrada, parcela menor que aluguel.
Objetivo: simulação gratuita ou encaminhar para corretor.
Quando classificar o lead, inclua no final: [STATUS:quente] ou [STATUS:morno] ou [STATUS:frio]
```

### Prompt `leilao`:
```
[BASE]
Especialidade: imóveis de leilão.
Triagem (uma pergunta por vez): morar ou investir → já conhece leilão → pagamento (à vista/financiado) → maior medo.
Classificação:
- QUENTE: conhece + tem capital → especialista
- MORNO: inseguro → educar + mostrar oportunidade
- FRIO: curioso → nutrir
Gatilhos: até 40% abaixo do mercado. Análise jurídica antes de qualquer lance.
Responder medos: golpe, dívidas, ocupação → sempre com segurança jurídica como diferencial.
Objetivo: agendar atendimento com especialista.
Quando classificar: [STATUS:quente] ou [STATUS:morno] ou [STATUS:frio]
```

### Prompt `regularizacao`:
```
[BASE]
Especialidade: regularização de imóveis.
Triagem (uma pergunta por vez): qual problema → tipo de imóvel → tem documentação → urgência.
Problemas: sem escritura, contrato de gaveta, inventário pendente, irregular na prefeitura.
Classificação:
- QUENTE: problema claro + urgente → jurídico
- MORNO: dúvida → esclarecer
- FRIO: só informação → educar
Objetivo: atendimento com especialista jurídico.
Quando classificar: [STATUS:quente] ou [STATUS:morno] ou [STATUS:frio]
```

---

## 🔀 ROTEAMENTO (agent/src/router.js)

```
Recebe { phone, text, isAudio, messageId }
  ↓
isAudio?
  → Sim: downloadMedia(messageId) → transcribe(buffer) → userMessage = texto transcrito
         clienteSentAudio = true
  → Não: userMessage = text
  ↓
getLead(phone)
  → null: upsertLead(phone, { segment: 'desconhecido', status: 'novo' })
  ↓
lead.segment === 'desconhecido'?
  → Sim: chat() com prompt desconhecido
         Resposta é JSON válido?
           → Sim: updateLeadSegment(phone, segment) → reply = parsed.reply
           → Não: reply = resposta direto
  → Não: chat() com prompt do segment → reply = resposta
  ↓
reply contém [STATUS:xxx]?
  → Sim: updateLeadStatus(phone, status extraído) → remover tag do reply
  ↓
saveMessage(phone, 'user', userMessage)
saveMessage(phone, 'assistant', reply)
  ↓
clienteSentAudio?
  → Sim: base64 = textToSpeech(reply) → sendAudio(phone, base64)
  → Não: sendText(phone, reply)
```

---

## 🖥️ PAINEL WEB (agent/public/index.html)

Interface dark, HTML puro + fetch nativo. Sem frameworks.

**Layout:**
- Sidebar esquerda: lista de leads com badge colorido (🟢🟡🔴), telefone, segmento, data
- Filtros no topo: dropdown status + dropdown segmento
- Painel direito: histórico de conversa estilo chat ao clicar no lead
- Atualização automática a cada 30s via `setInterval`

**Visual:** fundo `#0a1628`, accent `#a3e635` (verde limão), texto `#f1f5f9`. Fonte: `Inter` (Google Fonts). Flat/minimalista. Badges: verde/amarelo/vermelho/cinza por status.

---

## 🔌 API REST (agent/src/server.js)

```
GET  /webhook              → retorna 200 OK (health check da Evolution)
POST /webhook              → recebe eventos → chama webhook.parse() → router.handle()
GET  /api/leads            → lista leads com filtros ?status= ?segment= ?page= ?limit=20
GET  /api/leads/:phone     → lead + histórico completo
PUT  /api/leads/:phone     → atualizar status manualmente { status: "quente" }
GET  /api/stats            → { total, porStatus: {}, porSegmento: {} }
GET  /                     → serve public/index.html
```

---

## 📦 package.json (agent/)

```json
{
  "name": "alcantara-agent",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js"
  },
  "dependencies": {
    "openai": "^4.47.0",
    "pg": "^8.11.5",
    "express": "^4.19.2",
    "dotenv": "^16.4.5",
    "axios": "^1.7.2",
    "form-data": "^4.0.0"
  }
}
```

---

## 🐳 Dockerfile (agent/Dockerfile)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
```

---

## 🚀 ORDEM DE IMPLEMENTAÇÃO — SIGA EXATAMENTE

**Fase 1 — Infra**
1. `docker-compose.yml`
2. `agent/Dockerfile`
3. `agent/.env.example`
4. `agent/package.json`
5. `.gitignore` (ignorar `.env`, `node_modules`, `data/`)

**Fase 2 — Backend base**
6. `agent/src/db.js` — pool + init tabelas + todas as queries
7. `agent/src/prompts.js` — todos os prompts

**Fase 3 — IA + Evolution**
8. `agent/src/ai.js` — chat, transcribe, textToSpeech
9. `agent/src/evolution.js` — sendText, sendAudio, downloadMedia
10. `agent/src/router.js` — lógica completa de roteamento

**Fase 4 — Servidor**
11. `agent/src/webhook.js` — parse e validação
12. `agent/src/server.js` — Express completo
13. `agent/src/index.js` — entry point

**Fase 5 — Painel + Docs**
14. `agent/public/index.html` — painel completo
15. `README.md` — instruções de instalação e configuração

---

## ✅ CRITÉRIOS DE ACEITE

- [ ] `docker compose up --build` sobe os 3 serviços sem erro
- [ ] Evolution API acessível em `http://localhost:8080`
- [ ] Agente acessível em `http://localhost:3000`
- [ ] Webhook recebe mensagem de texto e responde via Evolution API
- [ ] Áudio recebido → transcrito → resposta em áudio
- [ ] Lead criado e atualizado no PostgreSQL automaticamente
- [ ] Segmento detectado automaticamente na primeira interação
- [ ] Status atualizado conforme triagem evolui
- [ ] Painel lista leads com badges e histórico ao clicar
- [ ] MAX 10 mensagens no contexto da IA (nunca mais)
- [ ] max_tokens fixo em 350 (nunca alterar)

---

## ❌ NÃO FAZER

- Não usar `gpt-4o` ou `gpt-4-turbo` — apenas `gpt-4o-mini`
- Não enviar histórico completo para a IA — máximo 10 mensagens
- Não gerar TTS em toda mensagem — somente se cliente enviou áudio
- Não usar Prisma, Sequelize ou qualquer ORM — apenas `pg` puro
- Não instalar React, Vue ou qualquer framework no frontend
- Não criar testes automatizados nesta fase
- Não pedir confirmação a cada arquivo — implementar fase completa de uma vez

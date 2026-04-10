# Karina — Agente IA WhatsApp
### Alcântara Negócios Imobiliários

Agente de IA para WhatsApp que faz triagem de leads imobiliários nos segmentos: Minha Casa Minha Vida, Leilão e Regularização de Imóveis.

---

## Pré-requisitos

- Docker + Docker Compose instalados
- Chave de API da OpenAI (`gpt-4o-mini`, `whisper-1`, `tts-1`)
- Porta 3000 e 8080 livres na máquina

---

## Instalação

### 1. Clone e configure variáveis de ambiente

```bash
cp agent/.env.example agent/.env
```

Edite `agent/.env` com suas credenciais:

```env
OPENAI_API_KEY=sk-...
EVOLUTION_API_KEY=chave-forte-aqui
EVOLUTION_INSTANCE=karina
POSTGRES_PASSWORD=senha-segura-aqui
```

> **Atenção:** O arquivo `agent/.env` nunca deve ser commitado no git.

### 2. Suba os serviços

```bash
docker compose up --build -d
```

Aguarde ~30 segundos para todos os serviços iniciarem.

### 3. Crie a instância do WhatsApp na Evolution API

```bash
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"karina","integration":"WHATSAPP-BAILEYS"}'
```

### 4. Conecte o WhatsApp (QR Code)

Acesse `http://localhost:8080/instance/connect/karina` com o header `apikey` para obter o QR Code e conectar o número.

Ou use o manager da Evolution API em `http://localhost:8080/manager`.

---

## Painel de Leads

Acesse: **http://localhost:3000**

- Sidebar esquerda: lista de leads com badge de status e segmento
- Filtros por status e segmento
- Painel direito: histórico de conversa ao clicar no lead
- Atualização automática a cada 30 segundos

---

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Painel web |
| `GET/POST` | `/webhook` | Recebe eventos da Evolution API |
| `GET` | `/api/leads` | Lista leads (`?status=&segment=&page=&limit=`) |
| `GET` | `/api/leads/:phone` | Lead + histórico completo |
| `PUT` | `/api/leads/:phone` | Atualizar status `{ status: "quente" }` |
| `GET` | `/api/stats` | Totais por status e segmento |

---

## Segmentos e Classificação

| Segmento | Valor no banco |
|----------|---------------|
| Minha Casa Minha Vida | `mcmv` |
| Imóveis de Leilão | `leilao` |
| Regularização | `regularizacao` |
| Não identificado | `desconhecido` |

| Status | Significado |
|--------|-------------|
| `novo` | Primeiro contato |
| `quente` | Perfil qualificado, pronto para corretor |
| `morno` | Interessado, precisa de nutrição |
| `frio` | Sem perfil no momento |

---

## Limites de tokens (nunca alterar)

- Histórico enviado à IA: **máximo 10 mensagens**
- `max_tokens` por resposta: **350**
- Modelo: **gpt-4o-mini**
- TTS: **apenas quando o cliente enviar áudio**

---

## Comandos úteis

```bash
# Ver logs de todos os serviços
docker compose logs -f

# Ver logs apenas do agente
docker compose logs -f agent

# Reiniciar apenas o agente (após alterar código)
docker compose restart agent

# Parar tudo
docker compose down

# Parar e remover volumes (apaga dados)
docker compose down -v
```

---

## Estrutura do projeto

```
/
├── agent/
│   ├── src/
│   │   ├── index.js       # Entry point
│   │   ├── server.js      # Express + rotas API
│   │   ├── webhook.js     # Parse eventos Evolution API
│   │   ├── router.js      # Lógica de roteamento de mensagens
│   │   ├── ai.js          # OpenAI: chat, whisper, tts
│   │   ├── evolution.js   # Cliente Evolution API
│   │   ├── db.js          # PostgreSQL: pool + queries
│   │   └── prompts.js     # System prompts por segmento
│   ├── public/
│   │   └── index.html     # Painel de leads
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── docker-compose.yml
├── .gitignore
└── README.md
```

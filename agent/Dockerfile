FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
# Instala dependências primeiro (cache layer)
COPY agent/package*.json ./
RUN npm install --omit=dev
# Copia código do agent
COPY agent/ .
# Copia painel CRM unificado
COPY crm/public/ /app/crm/public/
EXPOSE 3000
CMD ["node", "src/index.js"]

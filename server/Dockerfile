# ==========================================
# kikin-cliente/server — API (gateway) Node.js
# ==========================================
FROM node:26-alpine

WORKDIR /app

# Instala dependências (dev inclusas: migrações rodam via tsx no boot/one-off)
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3100

EXPOSE 3100

CMD ["node", "dist/main.js"]

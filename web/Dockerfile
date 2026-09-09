# ==========================================
# kikin-cliente/web — build Vite + Nginx (SPA)
# ==========================================
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY public ./public

# API same-origin: o Traefik roteia /api* para o gateway (kikin-cliente-server)
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ==========================================
FROM nginx:1.27-alpine AS runner

RUN rm -rf /etc/nginx/conf.d/* /usr/share/nginx/html/*

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

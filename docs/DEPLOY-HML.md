# Deploy HML — kikin-cliente (portal do cliente)

Igual ao padrão do Kikin: containers na rede docker `kikin` + Traefik (SSL).

| Item | Valor |
|---|---|
| Servidor | root@23.94.80.227 |
| Diretório | `/home/kikin-cliente/app` (clone do git) |
| Domínio | `https://hml-cliente.kikin.com.br` (DNS/Cloudflare → 23.94.80.227) |
| Banco | container `kikin-cliente-db` (Postgres 15, volume `/home/kikin-cliente/data/postgres`) |

## Topologia

```
Internet → Cloudflare → Traefik
   ├─ hml-cliente.kikin.com.br        → kikin-cliente-web   (SPA, /api e /auth caem no fallback SPA)
   └─ hml-cliente.kikin.com.br/api/*  → kikin-cliente-server (gateway :3100)
Rede kikin: kikin-cliente-server → kikin-backend (internal/client-portal + booking público)
```

## 1. Código

```bash
ssh root@23.94.80.227
mkdir -p /home/kikin-cliente && cd /home/kikin-cliente
git clone git@github.com:fcritelli/kikin-cliente.git app
cd app
```

## 2. .env

```bash
cp .env.hml.example .env
nano .env
```

Gere segredos: `openssl rand -hex 32`.

**Importante (HMAC ADR-002):** `KIKIN_CLIENT_PORTAL_SECRET` precisa ser **idêntico** ao
`KIKIN_CLIENT_PORTAL_SECRET` do backend do Kikin (`/home/kikin/app/.env`). Se o Kikin ainda não tem a
variável, adicione lá e recrie o backend:

```bash
echo "KIKIN_CLIENT_PORTAL_SECRET=$(openssl rand -hex 32)" >> /home/kikin/app/.env
# use o MESMO valor no .env do kikin-cliente
cd /home/kikin/app && docker compose up -d --force-recreate kikin-backend
```

**OAuth:** no Google Cloud e Microsoft Entra, adicione
`https://hml-cliente.kikin.com.br/auth` como redirect autorizado (client IDs = mesmos do Kikin).

## 3. Subir + migrar

```bash
docker compose -f docker-compose.hml.yml up -d --build
docker compose -f docker-compose.hml.yml run --rm kikin-cliente-server npm run db:migrate
docker compose -f docker-compose.hml.yml ps
```

## 4. Smoke test

```bash
curl -s https://hml-cliente.kikin.com.br/api/v1/booking/salons | head -c 200   # {"salons":[...]}
curl -sI https://hml-cliente.kikin.com.br/ | head -3                            # 200 SPA
```

## 5. Atualizar depois (novo código)

```bash
cd /home/kikin-cliente/app && git pull
docker compose -f docker-compose.hml.yml up -d --build
```

## Observações p/ produção (não HML)

- Domínio `cliente.kikin.com.br`, DNS sem proxy/ou com as mesmas regras, redirects OAuth novos.
- `EMAIL_VERIFY_RETURN_TOKEN=false` e `WHATSAPP_DEV_RETURN_CODE=false` (remover overrides do compose).
- SMTP real e provedor WhatsApp oficial (WABA Embedded Signup) configurados.

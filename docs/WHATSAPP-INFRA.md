# Infraestrutura WhatsApp no HML — OpenWA (canal não-oficial)

> Status: deploy feito em 23.94.80.227 (HML). Sessão `kikin-otp` conecta o número
> **+55 35 98855 8536** (engine `whatsapp-web.js`). Envio real de OTP pela Evolution/OpenWA;
> notificações oficiais futuras via WABA Embedded Signup (Meta) — ver seção final.

## O que está rodando
- **OpenWA** (github.com/rmyndharis/OpenWA) em Docker no servidor HML.
- URL pública: `https://wa.kikin.com.br` (Cloudflare proxy → Traefik `websecure` + TLS-ALPN `mytlschallenge`).
- Containers: `openwa-api` (porta interna 2785, dashboard incluso) + `openwa-docker-proxy`.
- Banco: SQLite (volumes em `/home/kikin/openwa/data` dentro do container `openwa-data`).
- Engine fixado: `ENGINE_TYPE=whatsapp-web.js` (Chromium; ~400-500MB/sessão).

## Comandos no servidor
```bash
cd /home/kikin/openwa
docker compose up -d --build        # (re)build + sobe
docker compose logs -f openwa-api
docker compose down                  # para (dados persistem no volume)
docker ps --filter name=openwa
curl http://127.0.0.1:2785/api/health/ready   # saúde local
```

## Chave de API / sessão
- Chave de API: arquivo `/app/data/.api-key` dentro do container `openwa-api` (não commitar).
- Endpoints úteis (header `X-API-Key: <chave>`):
  - criar sessão: `POST /api/sessions {"name":"kikin-otp"}`
  - iniciar: `POST /api/sessions/<uuid>/start`
  - QR: `GET /api/sessions/<uuid>/qr`
  - enviar texto: `POST /api/sessions/<uuid>/messages/send-text {"chatId":"5535988558536@c.us","text":"..."}`
- Dashboard/admin: primeiro acesso em `https://wa.kikin.com.br` usa a chave acima.

## Configuração no gateway (kikin-cliente)
```env
WHATSAPP_PROVIDER=openwa
WHATSAPP_OPENWA_URL=https://wa.kikin.com.br
WHATSAPP_OPENWA_API_KEY=<chave de API>
WHATSAPP_OPENWA_SESSION=kikin-otp
# desligar o retorno do código em dev quando estiver enviando de verdade
WHATSAPP_DEV_RETURN_CODE=false
```
Transporte já implementado em `server/src/services/whatsapp/whatsapp.service.ts`
(`POST /api/sessions/{session}/messages/send-text`, `chatId = 55…@c.us`).

## Notas operacionais
- Backup: volumes Docker (`openwa_openwa-data`) + parar container antes de copiar sqlite.
- Ao trocar engine/número: editar `.env` e `docker compose up -d --build`? (engine via env; sessão
  nova exige re-scan do QR).
- Risco de banimento inerente ao canal não-oficial (whatsapp-web.js). OTP = uso de baixo volume.

## Futuro: WABA Embedded Signup (Meta — oficial, para notificações)
- Setup oficial via Meta Business Manager (WhatsApp Cloud API) + Embedded Signup no frontend do
  kikin-cliente/admin; templates de notificação aprovados. Transporte `meta` já previsto no gateway.

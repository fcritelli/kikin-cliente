/* kikin-cliente — service worker (escopo raiz).
 *
 * Responsabilidade única: receber notificações push (mesmo com a aba fechada) e levar o
 * cliente de volta ao portal ao clicar. SEM estratégia de cache de fetch — apenas
 * pass-through (fetch(event.request)) para não quebrar o SPA nem versões antigas de
 * deploys. Registrado só em contexto seguro (https ou localhost) por ação do usuário.
 */

self.addEventListener("install", () => {
  // Ativa o SW novo sem esperar o usuário fechar todas as abas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Assume o controle das abas abertas (para o notificationclick navegar nelas).
  event.waitUntil(self.clients.claim());
});

// Pass-through: nenhuma estratégia de cache. O navegador segue o comportamento padrão.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "kikin.cliente";
  const options = {
    body: data.body || "",
    icon: "/kikin-symbol.png",
    badge: "/kikin-symbol-white.png",
    data: { url: data.url && String(data.url).startsWith("/") ? data.url : "/conta" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/conta", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const home = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (home) {
        await home.focus();
        if (new URL(home.url).pathname + new URL(home.url).search !== new URL(target).pathname + new URL(target).search) {
          await home.navigate(target);
        }
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});

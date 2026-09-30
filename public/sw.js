// Online-only PWA. Financial data, HTML pages and API responses are never cached.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PayAdmin · Sin conexión</title><body><main><h1>Necesitas conexión</h1><p>Conéctate a Internet y vuelve a abrir PayAdmin para consultar tus datos privados.</p><a href="/">Reintentar</a></main></body></html>',
            {
              status: 503,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            },
          ),
      ),
    );
  }
});

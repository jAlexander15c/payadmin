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
            `<!doctype html><html lang="es" data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>PayAdmin · Sin conexión</title><script>try{if(localStorage.getItem('payadmin_theme')==='light')document.documentElement.dataset.theme='light';}catch{}</script><style>:root{color-scheme:dark;--bg:#0f1714;--ink:#edf4ed;--accent:#9dddba}:root[data-theme="light"]{color-scheme:light;--bg:#f5f6f3;--ink:#26352f;--accent:#194e42}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}main{max-width:420px;padding:32px}p{line-height:1.7}a{color:var(--accent)}</style></head><body><main><h1>Necesitas conexión</h1><p>Conéctate a Internet y vuelve a abrir PayAdmin para consultar tus datos privados.</p><a href="/">Reintentar</a></main></body></html>`,
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

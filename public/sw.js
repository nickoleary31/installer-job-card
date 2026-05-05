const CACHE_NAME = "installer-shell-v3";

/** Same-origin shells and PWA wiring only — no Supabase, no /api */
const APP_SHELL_URLS = ["/", "/companies", "/offline", "/manifest.webmanifest", "/icon.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  console.log("[SW] install", CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL_URLS.map(async (path) => {
          try {
            await cache.add(new Request(path, { cache: "reload" }));
          } catch (e) {
            console.warn("[SW] precache skip:", path, e?.message || e);
          }
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] activate", CACHE_NAME);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

/**
 * Network-first navigate; offline: exact URL → cached /companies → /offline
 */
async function handleNavigate(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.ok) {
      try {
        await cache.put(request, networkResponse.clone());
      } catch {
        // ignore quota / put errors
      }
    }
    return networkResponse;
  } catch {
    console.log("[SW] navigation fallback: network failed", request.url);

    const exact = await cache.match(request, { ignoreSearch: false });
    if (exact) {
      console.log("[SW] navigation fallback hit: exact document");
      return exact;
    }

    const pathname = new URL(request.url).pathname;
    const pathUrl = new URL(pathname, self.location.origin).href;
    const pathMatch = await cache.match(pathUrl);
    if (pathMatch) {
      console.log("[SW] navigation fallback hit:", pathname);
      return pathMatch;
    }

    let companiesDoc = await cache.match("/companies");
    if (!companiesDoc) {
      companiesDoc = await cache.match(`${self.origin}/companies`);
    }
    if (companiesDoc) {
      console.log("[SW] navigation fallback hit: cached /companies");
      return companiesDoc;
    }

    const offlinePage = (await cache.match("/offline")) || (await cache.match(`${self.origin}/offline`));
    if (offlinePage) {
      console.log("[SW] navigation fallback hit: /offline");
      return offlinePage;
    }

    return new Response("Offline — open the app online once to cache companies.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Next static chunks/fonts: cache successful GET responses on use (offline replay).
 */
async function handleNextStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch {
        // ignore
      }
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("static asset offline miss");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleNextStatic(request));
    return;
  }

  // Optional: lightweight cache for manifest/icon refetches from same tab
});

const CACHE_NAME = "installer-shell-v4";

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

function pathnameOnlyHref(url) {
  return new URL(url.pathname, self.location.origin).href;
}

/**
 * Cache navigation response twice: exact request + pathname-only URL (helps /companies/[id]/projects offline replay).
 */
async function cacheNavigateResponse(request, networkResponse, cache) {
  if (!networkResponse?.ok) return;
  const urlObj = new URL(request.url);
  const pathKey = pathnameOnlyHref(urlObj);
  const pathReq = new Request(pathKey, { method: "GET", credentials: "same-origin" });
  try {
    await cache.put(request, networkResponse.clone());
    await cache.put(pathReq, networkResponse.clone());
  } catch {
    try {
      await cache.put(request, networkResponse.clone());
    } catch {
      // ignore
    }
  }
}

/**
 * Network-first navigate; offline: exact URL → pathname key → cached /companies → /offline
 */
async function handleNavigate(request) {
  const cache = await caches.open(CACHE_NAME);
  const navUrl = new URL(request.url);
  const pathname = navUrl.pathname;
  console.log("[SW] navigation request pathname", pathname, request.url);

  try {
    const networkResponse = await fetch(request);
    await cacheNavigateResponse(request, networkResponse, cache);
    return networkResponse;
  } catch {
    console.log("[SW] navigation fallback: network failed", pathname, request.url);

    const exact = await cache.match(request, { ignoreSearch: false });
    if (exact) {
      console.log("[SW] navigation fallback used: exact cached request");
      return exact;
    }

    const pathUrl = pathnameOnlyHref(navUrl);
    const pathMatch = await cache.match(pathUrl);
    if (pathMatch) {
      console.log("[SW] navigation fallback used: cached pathname document", pathname);
      return pathMatch;
    }

    /** Dynamic company projects shell: pathname-only match attempted above; next try app shell. */
    let companiesDoc = await cache.match("/companies");
    if (!companiesDoc) {
      companiesDoc = await cache.match(`${self.origin}/companies`);
    }
    if (companiesDoc) {
      console.log("[SW] navigation fallback used: cached /companies (app shell fallback)");
      return companiesDoc;
    }

    const offlinePage = (await cache.match("/offline")) || (await cache.match(`${self.origin}/offline`));
    if (offlinePage) {
      console.log("[SW] navigation fallback used: /offline");
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
 * Next.js RSC fetches (?_rsc=…): offline, avoid failed network-only pass-through — try cached pathname document.
 */
async function handleRscOffline(request) {
  const cache = await caches.open(CACHE_NAME);
  const urlObj = new URL(request.url);
  const pathname = urlObj.pathname;
  const pathKey = pathnameOnlyHref(urlObj);

  console.log("[SW] RSC/navigation-flight request pathname", pathname, urlObj.search);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse?.ok) {
      try {
        await cache.put(request, networkResponse.clone());
      } catch {
        // ignore
      }
    }
    return networkResponse;
  } catch {
    console.log("[SW] navigation fallback: _rsc network failed", pathKey);

    const exact = await cache.match(request);
    if (exact) {
      console.log("[SW] navigation fallback used: exact _rsc request cache");
      return exact;
    }

    const shell = await cache.match(pathKey);
    if (shell) {
      console.log("[SW] navigation fallback used: _rsc → cached pathname shell", pathname);
      return shell;
    }

    console.log("[SW] navigation fallback used: _rsc → empty offline stub");
    return new Response("", {
      status: 204,
      statusText: "Offline",
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

  if (url.search.includes("_rsc")) {
    event.respondWith(handleRscOffline(request));
    return;
  }

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

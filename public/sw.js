const CACHE_NAME = "installer-shell-v5";

/** Same-origin shells — open each route online once for freshest offline replay */
const APP_SHELL_URLS = ["/", "/companies", "/new-submission", "/offline", "/manifest.webmanifest", "/icon.png", "/icon.svg"];

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

async function cachedNewSubmissionDocument(cache) {
  return (
    (await cache.match("/new-submission")) ||
    (await cache.match(new Request(`${self.origin}/new-submission`, { method: "GET" }))) ||
    (await cache.match(new Request(`${self.origin}/new-submission/`)))
  );
}

function newSubmissionShellUnavailableHtml() {
  const msg =
    "Offline app shell could not load. Open New Submission once online before using offline.";
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>New Submission offline</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5;color:#0f172a}a{color:#2563eb}</style></head><body><h1 style="font-size:1.25rem">Cannot open New Submission</h1><p>${msg}</p><p><a href="/companies">Back to Companies</a></p></body></html>`,
    {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}

/**
 * Cache navigation response twice: exact request + pathname-only URL.
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
 * Network-first navigate; offline: exact → pathname → route-specific shells → /offline → HTML fallback
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

    /** Never substitute /companies for /new-submission (wrong shell). */
    if (pathname === "/new-submission" || pathname.startsWith("/new-submission/")) {
      const ns = await cachedNewSubmissionDocument(cache);
      if (ns) {
        console.log("[SW] navigation fallback used: cached /new-submission");
        return ns;
      }
      console.log("[SW] navigation fallback used: /new-submission unavailable — HTML message");
      return newSubmissionShellUnavailableHtml();
    }

    if (pathname.startsWith("/companies")) {
      let companiesDoc = await cache.match("/companies");
      if (!companiesDoc) {
        companiesDoc = await cache.match(`${self.origin}/companies`);
      }
      if (companiesDoc) {
        console.log("[SW] navigation fallback used: cached /companies (app shell fallback)");
        return companiesDoc;
      }
    }

    const offlinePage = (await cache.match("/offline")) || (await cache.match(`${self.origin}/offline`));
    if (offlinePage) {
      console.log("[SW] navigation fallback used: /offline");
      return offlinePage;
    }

    return new Response(
      "Offline — open the app online once to cache key pages (Companies, New Submission).",
      {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
}

/**
 * Next.js RSC fetches (?_rsc=…): try cached shell for pathname; /new-submission tries document cache before 204.
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

    if (pathname === "/new-submission" || pathname.startsWith("/new-submission/")) {
      const ns = await cachedNewSubmissionDocument(cache);
      if (ns) {
        console.log("[SW] navigation fallback used: _rsc → cached /new-submission document");
        return ns;
      }
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

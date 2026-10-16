// Zimi Service Worker
// Substituted at serve time to match the running server version (see
// http.py); the literal below is only a fallback for direct file use.
const CACHE_VERSION = 'zimi-vdev';
// The almanac's segment readout face is precached rather than left to the
// /static/ stale-while-revalidate path: it is a font, so a cold offline start
// that misses it falls back to system mono and the time machine's digits
// change face under the reader. Small enough (~6KB) to carry on install.
// Adding an entry here needs no CACHE_VERSION bump: changing these bytes makes
// the browser install a new SW, and install's addAll() adds into whatever
// cache CACHE_VERSION names (the server pins it to the asset-bundle hash).
const PRECACHE_URLS = ['/', '/favicon.png', '/apple-touch-icon.png',
                       '/static/fonts/DSEG14Classic-Bold.woff2'];

// What the shell, the Almanac and the Field Guide need to run with no
// server, at the addresses this deploy's pages ask for (they carry a content
// hash, so only the server can list them): filled in at serve time by
// http.py from the pages themselves. Kept separately from PRECACHE_URLS: a
// file that fails to fetch is skipped rather than failing the whole install,
// which would leave the phone with no service worker at all. The big
// pictures (the 3D Earth's textures, three.js) are not here; /static/ keeps
// them the first time they are opened.
const SHELL_URLS = [];

// The page shown when nothing can be served at all: the shell was never kept
// (the app has not been opened with a connection since it was installed).
// It says which of three things is true, from what the browser knows, and
// uses the words the app last kept for the reader's language (localStorage is
// the app's own; this page is the same origin). English is the fallback.
const OFFLINE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zimi</title>
<style>
  body { background: #0a0a0b; color: #e0e0e0; font-family: -apple-system, system-ui, sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 0 24px; box-sizing: border-box; }
  .msg { text-align: center; max-width: 22rem; }
  h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 0.5rem; }
  p { color: #999; font-size: 0.95rem; line-height: 1.45; }
  button { margin-top: 1rem; min-height: 44px; padding: 0 20px; border-radius: 22px; border: 1px solid #444;
           background: none; color: inherit; font: inherit; }
</style>
</head><body><div class="msg">
  <h1 id="h"></h1>
  <p id="p"></p>
  <button id="b" type="button"></button>
</div>
<script>
var EN = {
  nonet: ['You\\'re offline', 'This device has no connection. Open Zimi again once you\\'re back on a network.'],
  server: ['Can\\'t reach your Zimi server', 'This device is online, but your Zimi server isn\\'t answering. It may be off, or you may be away from its network.'],
  retry: 'Retry'
};
var kept = {};
try {
  var lang = localStorage.getItem('zimi_ui_lang') || (navigator.language || 'en').split('-')[0];
  kept = JSON.parse(localStorage.getItem('zimi_i18n_kept_' + lang) || '{}') || {};
} catch (e) {}
function word(key, fallback) { return kept[key] || fallback; }
function show() {
  var offline = navigator.onLine === false;
  document.getElementById('h').textContent = offline ? word('offline_title_nonet', EN.nonet[0]) : word('offline_title_server', EN.server[0]);
  document.getElementById('p').textContent = offline ? word('offline_page_nonet_hint', EN.nonet[1]) : word('offline_page_server_hint', EN.server[1]);
  document.getElementById('b').textContent = word('conn_retry', EN.retry);
}
show();
document.getElementById('b').onclick = function() { location.reload(); };
window.addEventListener('online', function() { location.reload(); });
window.addEventListener('offline', show);
setInterval(function() { fetch('/', { cache: 'no-store' }).then(function(r) { if (r.ok) location.reload(); }).catch(function() {}); }, 5000);
</script>
</body></html>`;

// Install: precache essential assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS)
        .then(() => Promise.allSettled(SHELL_URLS.map(u => cache.add(u)))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches, claim clients, version check
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => checkVersion())
  );
});

// Version check: if the server's asset bundle differs from what this SW was
// built against, drop caches and unregister so the next load is fully fresh.
// Compares the content-hashed asset_version (falls back to the version string
// for older servers that don't report asset_version yet).
async function checkVersion() {
  try {
    const resp = await fetch('/health', { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json();
      const serverVer = data.asset_version || (data.version ? 'zimi-v' + data.version : null);
      if (serverVer && serverVer !== CACHE_VERSION) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        await self.registration.unregister();
      }
    }
  } catch (e) {
    // Server unreachable, keep running
  }
}

// Identity + auth-scoped data endpoints. Their responses vary by the
// authenticated identity (anonymous vs named user vs admin) AND by the
// public-access mode, so the service worker MUST NEVER cache or serve them
// stale. Caching them leaks one identity's view to another:
//   - a stale /whoami re-shows the login gate to a just-signed-in user (they
//     "sign in twice"), or hides it from someone who logged out;
//   - a cached full-library /list (or /search) served on a network blip shows
//     the whole library to a now-anonymous visitor of a private instance.
// These fail CLOSED: on network failure they return the offline page rather
// than a wrong-identity cached response. Kept as a single source of truth so
// the classification is testable (see tests/test_sw_route_classification.mjs).
// The apps' feeds (/places, /tube, /exchange, /reddot) and a person's own
// preferences (/me) expose the library or an identity the same way, so they
// fail closed too: a cached feed served to the wrong visitor, or an old feed
// after a deploy, is the same bug twice.
// /collections too: a person's own collections and favorites, which name ZIMs
// as /list does; left to the default stale-while-revalidate, a collection
// created or deleted did not show until the next reload.
// /userdata: an account's own saved things. Served stale, a second device
// never saw what the first had saved, and the account's copy outlived a
// sign-out in the cache.
// The Dictionary's voices: /dictionary/voices says who may fetch a voice and
// what the server can say now (a download changes it), and /dictionary/speak
// is audio asked for by range, which the cache cannot hold.
// The Field Guide's answers (/fieldguide, /situation, /match, /print, /library)
// name the ZIMs installed, and a private server shows them to signed-in
// visitors only; they were once left to stale-while-revalidate and a
// signed-out phone could be shown them. Offline the page reads the guide's own
// copy instead (/static/fieldguide-offline.json: public text, kept like any
// static file), so nothing is lost by never keeping these.
const NETWORK_ONLY_PREFIXES = ['/whoami', '/login', '/logout', '/list', '/search', '/suggest', '/random', '/places', '/tube', '/exchange', '/reddot', '/me', '/collections', '/userdata', '/dictionary/voices', '/dictionary/speak', '/fieldguide'];

// Pages a person read are kept for offline (/w/, /read), under the identity
// that read them. A sign-in or sign-out changes who is holding the phone, so
// each one empties those copies: the next person offline is never shown what
// the last could read. The cost is that signing out forgets what was kept.
const IDENTITY_CHANGE_PATHS = ['/login', '/logout'];
const KEPT_CONTENT_PREFIXES = ['/w', '/read'];

// Non-identity API/data (article reads, health, manage, language lists). These
// do not expose the library index and tolerate a cached fallback when offline.
// /almanac-satellites too: the freshest orbital elements when the server
// answers, the last ones seen when it does not.
const NETWORK_FIRST_PREFIXES = ['/read', '/health', '/manage', '/article-languages', '/languages', '/almanac-satellites', '/almanac-ages'];

function _hasPrefix(path, prefixes) {
  for (let i = 0; i < prefixes.length; i++) {
    if (path === prefixes[i] || path.startsWith(prefixes[i] + '/') ||
        path.startsWith(prefixes[i] + '?')) return true;
  }
  return false;
}

// The single source of truth for which cache strategy a request uses. Pure
// function of the pathname + request mode so it can be asserted directly.
function routeStrategy(path, requestMode, destination) {
  if (_hasPrefix(path, NETWORK_ONLY_PREFIXES)) return 'networkOnly';
  if (_hasPrefix(path, NETWORK_FIRST_PREFIXES)) return 'networkFirst';
  // ZIM content: top-level navigation (reload/bookmark) needs the SPA shell so
  // the client-side router handles the deep link. Sub-resources are
  // network-first, NOT cache-first: a ZIM name outlives its file (auto-update
  // replaces archives in place; delete-then-recreate reuses names), and a
  // cache-first hit never asks again — a phone spent an afternoon rendering a
  // deleted capture's pages. The server answers /w/ with an ETag keyed to the
  // file's identity and Cache-Control: no-cache, so the network path is a
  // cheap conditional GET online, and the cache still carries reads offline.
  // The reader's frame is also a navigation, but it asks for the article
  // itself: it is kept for offline like any sub-resource, and answered by the
  // shell only when the whole window is what is navigating.
  if (path.startsWith('/w/')) {
    return requestMode === 'navigate' && destination !== 'iframe' ? 'navigateShell' : 'networkFirst';
  }
  if (path.startsWith('/static/')) return 'staleWhileRevalidate';
  // The shell (and any address the app answers for): the latest after a
  // deploy; when the server cannot be reached, the shell last kept, which says
  // what is true and what still works.
  if (path === '/' || requestMode === 'navigate') return 'shell';
  return 'staleWhileRevalidate';
}
self.routeStrategy = routeStrategy;  // test hook

// Fetch strategy router
self.addEventListener('fetch', event => {
  // A ranged request (a <video>, ogv.js's reader, Say's audio) goes to the
  // network untouched. Through networkFirst every 206 was cloned for a cache
  // that refuses partial responses, and a whole-file answer was teed into
  // Cache Storage: a TED talk's 65 MB copied on an iPhone while it played.
  if (event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  switch (routeStrategy(url.pathname, event.request.mode, event.request.destination)) {
    case 'networkOnly':
      event.respondWith(networkOnly(event.request));
      return;
    case 'networkFirst':
      event.respondWith(networkFirst(event.request));
      return;
    case 'shell':
      event.respondWith(shellNavigation(event.request));
      return;
    case 'navigateShell':
      // Fetch from network; if offline, fall back to the cached SPA shell '/'.
      event.respondWith(
        fetch(event.request).catch(() => caches.match('/').then(r => r || offlineResponse()))
      );
      return;
    case 'cacheFirst':
      event.respondWith(cacheFirst(event.request));
      return;
    default:
      event.respondWith(staleWhileRevalidate(event.request));
  }
});

// Network-only: never read or write the cache. Identity/auth-scoped endpoints
// use this so a stale response can never stand in for the live, correctly
// authorized one. Offline → the offline page, never a wrong-identity cache hit.
async function networkOnly(request) {
  try {
    const resp = await fetch(request);
    if (resp.ok && _hasPrefix(new URL(request.url).pathname, IDENTITY_CHANGE_PATHS)) {
      await purgeKeptContent();
    }
    return resp;
  } catch (e) {
    return offlineResponse();
  }
}

// Forget the pages kept for offline reading (see IDENTITY_CHANGE_PATHS).
async function purgeKeptContent() {
  try {
    const cache = await caches.open(CACHE_VERSION);
    const keys = await cache.keys();
    await Promise.all(keys.filter(r => _hasPrefix(new URL(r.url).pathname, KEPT_CONTENT_PREFIXES))
      .map(r => cache.delete(r)));
  } catch (e) {}
}

// A proxy or tunnel in front of a server that is down or restarting answers
// for it: its own 502/503/504 page is not the server speaking, so it never
// stands in for the app or a kept page.
function _gatewayDown(resp) {
  return (resp.status === 502 || resp.status === 503 || resp.status === 504) &&
    !/json/.test(resp.headers.get('Content-Type') || '');
}

// A navigation: the page from the server; or, when it cannot be reached (no
// network, or a proxy answering for a dead server), the exact page last kept,
// else the shell, which boots from the device and says what is true. Only a
// device that never kept the shell sees OFFLINE_HTML.
async function shellNavigation(request) {
  let resp = null;
  try { resp = await fetch(request); } catch (e) { /* unreachable */ }
  if (resp && !_gatewayDown(resp)) {
    if (resp.ok && resp.status !== 206) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, resp.clone()).catch(() => {});
    }
    return resp;
  }
  return (await caches.match(request)) || (await caches.match('/')) || offlineResponse();
}

// Sound and pictures that move are streamed, never kept: a whole video in
// Cache Storage is the phone's space and a long copy while it plays.
function _isMedia(resp) {
  return /^(video|audio)\//.test(resp.headers.get('Content-Type') || '');
}

// Network-first: try network, fall back to cache, then offline page
async function networkFirst(request) {
  try {
    const resp = await fetch(request);
    if (resp.ok && resp.status !== 206 && !_isMedia(resp)) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, resp.clone()).catch(() => {});
    } else if (_gatewayDown(resp)) {
      const kept = await caches.match(request);
      if (kept) return kept;
    }
    return resp;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineResponse();
  }
}

// Cache-first: serve from cache, fetch if missing
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, resp.clone());
    }
    return resp;
  } catch (e) {
    return offlineResponse();
  }
}

// Stale-while-revalidate: serve cache immediately, update in background
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(resp => {
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);

  if (cached) {
    // Revalidation already running in background (initiated above), return cached immediately
    fetchPromise.catch(() => {}); // suppress unhandled rejection
    return cached;
  }
  // Nothing cached, must wait for network
  const resp = await fetchPromise;
  if (resp) return resp;
  return offlineResponse();
}

// Offline fallback response.
//
// The X-Zimi-Offline header is the contract with the app shell: this body was
// synthesised here because the network never answered, NOT by the server. The
// client's serverFetch() keys off it to tell "the server said you have no
// ZIMs" apart from "we could not ask" — without it a /list that resolves to
// this 503 HTML looks, after a failed .json(), exactly like an empty library.
function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Zimi-Offline': '1',
      'Cache-Control': 'no-store'
    }
  });
}

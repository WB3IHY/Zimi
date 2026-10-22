// Settings follow the account (Eric, 2026-10-21: "Things a user changes while
// signed in should sync to all sessions all browsers"). Two browsers signed in
// to one account: a setting changed in one is in the other, for the admin and
// for a named user; two browsers changing different settings keep both; a
// browser that changed nothing sends nothing; and boot waits on none of it.
//
// Start it on a brand-new data dir (beforeAll sets the password and users):
//   ZIM_DIR=<a few zims> ZIMI_DATA_DIR=<fresh dir> ZIMI_MANAGE=1 \
//     ZIMI_TORRENT=0 ZIMI_OFFLINE=1 python3 -m zimi serve --port 9701
//   BASE_URL=http://localhost:9701 npx playwright test \
//     --config=tests/playwright.config.mjs tests/test_settings_sync.spec.mjs

import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const BASE = process.env.BASE_URL || 'http://localhost:9701';
const ADMIN_PW = 'sync-admin-pw';
const USER = 'reader';
const USER_PW = 'reader-pw';
const FRESH = 'fresh';

// Each browser keeps its own session: two per account, signed in once here
// (sign-ins are rate limited), each test's browsers made from them.
const states = {};
async function signIn(browser, who) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await page.request.post(`${BASE}/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: { username: who === 'admin' ? 'admin' : who, password: who === 'admin' ? ADMIN_PW : USER_PW, remember: true },
  });
  expect(res.status(), await res.text()).toBe(200);
  const j = await res.json();
  await page.goto(BASE);
  if (who === 'admin') await page.evaluate((tok) => { localStorage.setItem('zimi_manage_token', tok); }, j.token);
  const state = await context.storageState();
  await context.close();
  return state;
}

test.beforeAll(async ({ request, browser }) => {
  await request.post(`${BASE}/manage/set-password`, {
    headers: { 'Content-Type': 'application/json' },
    data: { password: ADMIN_PW },
  });
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN_PW };
  for (const name of [USER, FRESH]) {
    await request.post(`${BASE}/manage/users`, { headers: auth, data: { action: 'create', name, password: USER_PW } });
  }
  for (const who of ['admin', USER]) states[who] = [await signIn(browser, who), await signIn(browser, who)];
  states[FRESH] = [await signIn(browser, FRESH)];
});

// Browser ``slot`` of ``who``, on the home page, signed in.
async function signedIn(browser, who, slot) {
  const context = await browser.newContext({ storageState: states[who][slot] });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => typeof _savedSignedIn === 'function' && _savedSignedIn());
  return { context, page };
}
const account = (page) => page.evaluate(async () => (await (await fetch('/userdata', { credentials: 'same-origin' })).json()).settings || {});
const raw = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
// Comes back to the tab: the account's copy is fetched again.
const refocus = (page) => page.evaluate(() => { _savedPulledAt = 0; document.dispatchEvent(new Event('visibilitychange')); });

for (const who of ['admin', USER]) {
  test(`${who}: a setting changed in one browser is in the other, and the page follows it`, async ({ browser }) => {
    const a = await signedIn(browser, who, 0);
    const b = await signedIn(browser, who, 1);
    await a.page.evaluate(() => { _setPrefLanguages(['en', 'es']); _setReaderTheme('sepia'); });
    await expect.poll(async () => ((await account(a.page)).zimi_pref_languages || {}).v, { timeout: 10000 }).toBe('["en","es"]');
    // B, open all along, picks it up on coming back to it
    await refocus(b.page);
    await expect.poll(() => raw(b.page, 'zimi_pref_languages'), { timeout: 10000 }).toBe('["en","es"]');
    expect(await raw(b.page, 'zimi_reader_theme')).toBe('sepia');
    expect(await b.page.evaluate(() => _getPrefLanguages())).toEqual(['en', 'es']);
    // and a fresh page of B starts with it
    await b.page.reload();
    expect(await b.page.evaluate(() => _getPrefLanguages())).toEqual(['en', 'es']);
    await a.context.close(); await b.context.close();
  });

  test(`${who}: two browsers changing different settings keep both`, async ({ browser }) => {
    const a = await signedIn(browser, who, 0);
    const b = await signedIn(browser, who, 1);
    await a.page.evaluate(() => _setLibraryView('tiles'));
    await b.page.evaluate(() => _setReaderFontStep(3));
    const font = await b.page.evaluate(() => String(READER_FONT_LEVELS[3]));
    await expect.poll(async () => {
      const s = await account(a.page);
      return [(s.zimi_library_view || {}).v, (s.zimi_reader_font_scale || {}).v];
    }, { timeout: 10000 }).toEqual(['tiles', font]);
    await refocus(a.page); await refocus(b.page);
    await expect.poll(() => raw(a.page, 'zimi_reader_font_scale'), { timeout: 10000 }).toBe(font);
    await expect.poll(() => raw(b.page, 'zimi_library_view'), { timeout: 10000 }).toBe('tiles');
    expect(await raw(a.page, 'zimi_library_view')).toBe('tiles');
    await a.context.close(); await b.context.close();
  });
}

test('the interface language follows too, switching the page it lands on', async ({ browser }) => {
  const a = await signedIn(browser, USER, 0);
  const b = await signedIn(browser, USER, 1);
  await a.page.evaluate(() => setLanguage('es'));
  await expect.poll(async () => ((await account(a.page)).zimi_ui_lang || {}).v, { timeout: 10000 }).toBe('es');
  await refocus(b.page);
  await expect.poll(() => b.page.evaluate(() => document.documentElement.lang), { timeout: 10000 }).toBe('es');
  await a.page.evaluate(() => setLanguage('en'));
  await a.context.close(); await b.context.close();
});

test('a browser that changed nothing sends nothing, and boot waits on none of it', async ({ browser }) => {
  const context = await browser.newContext({ storageState: states[FRESH][0] });
  const page = await context.newPage();
  const seen = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/userdata' || u.pathname === '/list') seen.push([u.pathname, r.method(), Date.now()]); });
  const listDone = page.waitForResponse((r) => new URL(r.url()).pathname === '/list');
  await page.goto(BASE);
  await listDone;
  const listAt = Date.now();
  await page.waitForFunction(() => _savedSignedIn());
  await page.waitForTimeout(3500); // past the push's wait
  expect(await account(page)).toEqual({});
  expect(seen.filter((s) => s[0] === '/userdata' && s[1] === 'POST')).toHaveLength(0);
  const firstData = seen.find((s) => s[0] === '/userdata');
  expect(firstData, 'the account is fetched once the page is up').toBeTruthy();
  expect(firstData[2], 'not before the library').toBeGreaterThanOrEqual(seen.find((s) => s[0] === '/list')[2]);
  expect(listAt).toBeGreaterThan(0);
  await context.close();
});

// Last: it ends that browser's session.
test('signed out, nothing goes to any account and the browser keeps its settings', async ({ browser }) => {
  const a = await signedIn(browser, USER, 0);
  await a.page.evaluate(() => _setReaderTheme('light'));
  await expect.poll(async () => ((await account(a.page)).zimi_reader_theme || {}).v, { timeout: 10000 }).toBe('light');
  await a.page.evaluate(() => userLogout());
  await a.page.waitForURL(BASE + '/');
  await a.page.waitForFunction(() => typeof _savedSignedIn === 'function' && !_savedSignedIn());
  expect(await raw(a.page, 'zimi_reader_theme')).toBe('light');
  const r = await a.page.evaluate(async () => (await fetch('/userdata')).status);
  expect(r).toBe(401);
  await a.context.close();
});

// The Almanac's world clocks as a person uses them: any clock in All can be
// saved with its star; Saved shows the place's own clock and the saved ones
// with a "+ Add a clock" tile; with nothing saved it says so in one line. The
// logic half (which cards each view shows) is tests/test_tz_card_match.cjs.
//
// Start a server first, on its own folders (no ZIMs needed):
//   ZIMI_TORRENT=0 ZIMI_OFFLINE=1 ZIM_DIR=/tmp/zimi-empty ZIMI_DATA_DIR=/tmp/zimi-empty-data \
//     python3 -m zimi serve --host 127.0.0.1 --port 8877
// Run:
//   BASE_URL=http://127.0.0.1:8877 npx playwright test \
//     --config=tests/playwright.config.mjs --reporter=list tests/test_almanac_clocks.spec.mjs

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8877';
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 180000 });
// The Almanac is heavy to draw: on a busy machine give each wait room.
test.beforeEach(({ page }) => page.setDefaultTimeout(60000));
expect.configure({ timeout: 30000 });
const PHONE = { width: 390, height: 844 };
const SAN_FRANCISCO = { lat: 37.77, lon: -122.42, name: 'San Francisco' };
const CLOCKS_KEY = 'zimi_almanac_clocks';
const VIEW_KEY = 'zimi_almanac_clocks_view';
const THEMES = ['light', 'dark', 'red'];

async function openAlmanac(page, { lang, theme, keep } = {}) {
  await page.setViewportSize(PHONE);
  await page.addInitScript(([lg, th, loc, keepStore]) => {
    try {
      if (lg) localStorage.setItem('zimi_ui_lang', lg);
      if (th) localStorage.setItem('zimi_app_theme', th);
      sessionStorage.setItem('zimi_almanac_location', JSON.stringify(loc));
      // A fresh visit starts with nothing saved; a reload (keep) leaves what was.
      if (!keepStore && !sessionStorage.getItem('__clocks_init')) {
        sessionStorage.setItem('__clocks_init', '1');
        localStorage.removeItem('zimi_almanac_clocks');
        localStorage.removeItem('zimi_almanac_clocks_view');
      }
    } catch (e) { /* private window: the defaults do */ }
  }, [lang || '', theme || '', SAN_FRANCISCO, !!keep]);
  await page.goto(`${BASE}/#almanac`);
  await page.waitForFunction(() => document.querySelectorAll('#almanac-tz-pills .alm-tz-city-card').length > 5);
}
const cards = (page) => page.locator('#almanac-tz-pills .alm-tz-city-card');
const star = (page, tz) => page.locator(`#almanac-tz-pills .alm-tz-star[data-tz="${tz}"]`);
const view = (page, name) => page.locator('#almanac-tz-view .alm-scope-btn', { hasText: name });
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

test.describe('world clocks: Saved and All', () => {
  test('All is the first view: every clock has a star but the place\'s own', async ({ page }) => {
    await openAlmanac(page);
    await expect(view(page, 'All')).toHaveAttribute('aria-selected', 'true');
    await expect(view(page, 'Saved')).toHaveAttribute('aria-selected', 'false');
    const n = await cards(page).count();
    expect(n).toBeGreaterThanOrEqual(25);
    // Every card but the place's own carries one star, a labelled toggle.
    expect(await page.locator('#almanac-tz-pills .alm-tz-star').count()).toBe(n - 1);
    await expect(star(page, 'Asia/Tokyo')).toHaveAttribute('aria-label', 'Save Tokyo');
    await expect(star(page, 'Asia/Tokyo')).toHaveAttribute('aria-pressed', 'false');
    await expect(star(page, 'America/Los_Angeles')).toHaveCount(0);
  });

  test('a star saves a clock and does not choose it; Saved then shows it with a plus tile', async ({ page }) => {
    await openAlmanac(page);
    await star(page, 'Asia/Tokyo').click();
    await expect(star(page, 'Asia/Tokyo')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(await stored(page, CLOCKS_KEY))).toEqual(['Asia/Tokyo']);
    // Saving is not choosing: the big clock still shows the place's own zone.
    expect(await page.evaluate(() => _almSelectedTz)).toBe(null);
    await view(page, 'Saved').click();
    await expect(view(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
    // The place's own clock, the saved one, and the way to add more.
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(1)).toContainText('Tokyo');
    await expect(page.locator('#almanac-tz-pills .alm-tz-add')).toHaveText('+ Add a clock');
    await expect(page.locator('#almanac-tz-pills .alm-tz-hint')).toHaveCount(0);
    expect(await stored(page, VIEW_KEY)).toBe('saved');
  });

  test('with nothing saved, Saved says what to do in one line', async ({ page }) => {
    await openAlmanac(page);
    await view(page, 'Saved').click();
    await expect(cards(page)).toHaveCount(1);
    const hint = page.locator('#almanac-tz-pills .alm-tz-hint');
    await expect(hint).toHaveText('Nothing saved yet. In All, tap the star on a clock to keep it here.');
    // One line of plain words: no em dash, and it stays on screen's width.
    expect(await hint.innerText()).not.toContain('—');
  });

  test('a clock let go of in Saved leaves it; the view and the list survive a reload', async ({ page }) => {
    await openAlmanac(page);
    await star(page, 'Europe/Paris').click();
    await star(page, 'Asia/Tokyo').click();
    await view(page, 'Saved').click();
    await expect(cards(page)).toHaveCount(3);
    await star(page, 'Asia/Tokyo').click();
    await expect(cards(page)).toHaveCount(2);
    expect(JSON.parse(await stored(page, CLOCKS_KEY))).toEqual(['Europe/Paris']);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#almanac-tz-pills .alm-tz-city-card').length >= 1);
    await expect(view(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
    await expect(cards(page)).toHaveCount(2);
    await expect(star(page, 'Europe/Paris')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the plus tile opens the zone search, and the zone chosen is saved', async ({ page }) => {
    await openAlmanac(page);
    await view(page, 'Saved').click();
    await page.locator('#almanac-tz-pills .alm-tz-add').click();
    await page.locator('.alm-clock-sheet .tk-search').fill('Reykjavik');
    await page.locator('.alm-clock-sheet .tk-opt').first().click();
    await expect(cards(page)).toHaveCount(2);
    expect(JSON.parse(await stored(page, CLOCKS_KEY))).toEqual(['Atlantic/Reykjavik']);
  });

  test('a saved clock that is chosen goes back to the place\'s own when Saved forgets it', async ({ page }) => {
    await openAlmanac(page);
    await star(page, 'Asia/Tokyo').click();
    await page.locator('#almanac-tz-pills .alm-tz-city-card', { hasText: 'Tokyo' }).click();
    expect(await page.evaluate(() => _almSelectedTz)).toBe('Asia/Tokyo');
    await view(page, 'Saved').click();
    await star(page, 'Asia/Tokyo').click();
    expect(await page.evaluate(() => _almSelectedTz)).toBe(null);
  });

  test('the star is reachable and works from the keyboard', async ({ page }) => {
    await openAlmanac(page);
    await star(page, 'Asia/Tokyo').focus();
    await page.keyboard.press('Enter');
    await expect(star(page, 'Asia/Tokyo')).toHaveAttribute('aria-pressed', 'true');
    // The grid is drawn again on a toggle; the focus is still on that star.
    await expect(star(page, 'Asia/Tokyo')).toBeFocused();
  });

  for (const theme of THEMES) {
    test(`reads in ${theme}: a saved star takes the page's amber`, async ({ page }) => {
      await openAlmanac(page, { theme });
      await star(page, 'Asia/Tokyo').click();
      const c = await page.evaluate(() => ({
        star: getComputedStyle(document.querySelector('#almanac-tz-pills .alm-tz-star.on')).color,
        amber: (() => { const d = document.createElement('i'); d.style.color = 'var(--amber)'; document.getElementById('almanac-view').appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; })(),
      }));
      expect(c.star).toBe(c.amber);
    });
  }

  test('right to left: the switch and the stars sit at the start', async ({ page }) => {
    await openAlmanac(page, { lang: 'ar' });
    const g = await page.evaluate(() => {
      const card = document.querySelector('#almanac-tz-pills .alm-tz-star').closest('.alm-tz-city-card').getBoundingClientRect();
      const st = document.querySelector('#almanac-tz-pills .alm-tz-star').getBoundingClientRect();
      return { dir: document.documentElement.dir, fromRight: card.right - st.right, fromLeft: st.left - card.left, over: document.documentElement.scrollWidth > innerWidth };
    });
    expect(g.dir).toBe('rtl');
    expect(g.fromRight).toBeLessThan(g.fromLeft);
    expect(g.over).toBe(false);
  });
});

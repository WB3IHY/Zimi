// ZimiGames inside Zimi has one header: the game's name where the search box is, its Undo or Pause and
// Menu beside it, the heart keeps it as a favorite, and Random is always a game.
//
//   ZIMI_MANAGE_OPEN=1 ZIMI_TORRENT=0 ZIMI_OFFLINE=1 ZIM_DIR=<empty dir> python3 -m zimi serve --port 9073
//   BASE_URL=http://localhost:9073 npx playwright test --config=tests/playwright.config.mjs tests/test_games_header.spec.mjs
//
// The games ZIM is Zimi's own (ZIMI_BUILTIN_ZIMS unset), so the library needs nothing else.

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:9073';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openGame(page, path) {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE + '/?a=' + encodeURIComponent('zimi_games/' + path));
  await expect(page.locator('#reader')).toHaveClass(/open/);
}

test('a game has one header: its name, Undo and Menu in Zimi\'s bar, none in the page', async ({ page }) => {
  await openGame(page, 'checkers.html');
  await expect(page.locator('#game-title')).toHaveText('Checkers');
  await expect(page.locator('.topbar-search')).toBeHidden();
  await expect(page.locator('#game-act-btn')).toBeVisible();
  await expect(page.locator('#game-menu-btn')).toBeVisible();
  const frame = page.frameLocator('#reader-frame');
  await expect(frame.locator('.ar-bar')).toBeHidden();
  // Menu opens the page's own sheet; Escape closes it
  await page.locator('#game-menu-btn').click();
  await expect(frame.locator('.gs-sheet')).toBeVisible();
});

test('the shelf is titled ZimiGames with no Undo, Menu or heart', async ({ page }) => {
  await openGame(page, 'index.html');
  await expect(page.locator('#game-title')).toHaveText('ZimiGames');
  await expect(page.locator('#game-act-btn')).toBeHidden();
  await expect(page.locator('#game-menu-btn')).toBeHidden();
  await expect(page.locator('#library-btn')).toBeHidden();
});

test('the heart keeps a game, and the shelf lists it under Favorites', async ({ page }) => {
  await openGame(page, 'checkers.html');
  // a server keeps hearts for everyone on it: start from none
  await page.evaluate(() => Saved.all().filter((i) => i.zim === 'zimi_games').forEach((i) => Saved.remove(i)));
  await page.evaluate(() => _updateLibraryBtnIcon());
  if ((await page.locator('#library-btn').getAttribute('title')) === 'Remove from favorites') await page.locator('#library-btn').click();
  await expect(page.locator('#library-btn')).toHaveAttribute('title', 'Add to favorites');
  await page.locator('#library-btn').click();
  await expect(page.locator('#library-btn')).toHaveAttribute('title', 'Remove from favorites');
  await page.evaluate(() => openArticle('zimi_games', 'index.html', 'x'));
  const fav = page.frameLocator('#reader-frame').locator('#sh-favorites a.ar-game');
  await expect(fav).toHaveCount(1);
  await expect(fav.first()).toContainText('Checkers');
  await page.evaluate(() => Saved.remove({ zim: 'zimi_games', path: 'checkers.html' }));
});

test('Random inside the games is always a game of the shelf', async ({ page, request }) => {
  const shelf = await (await request.get(BASE + '/w/zimi_games/games.json')).json();
  const paths = new Set(shelf.map((r) => r.path));
  for (let i = 0; i < 25; i++) {
    const got = await (await request.get(BASE + '/random?zim=zimi_games&not=chess.html')).json();
    expect(paths.has(got.path)).toBeTruthy();
    expect(got.path).not.toBe('chess.html');
  }
});

test('a Tatham puzzle has the one header too: its name, no Menu, no second bar', async ({ page }) => {
  await openGame(page, 'puzzles/fifteen.html');
  await expect(page.locator('#game-title')).toHaveText('Fifteen');
  await expect(page.locator('.topbar-search')).toBeHidden();
  await expect(page.locator('#game-menu-btn')).toBeHidden();
});

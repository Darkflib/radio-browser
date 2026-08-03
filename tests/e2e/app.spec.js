import { test, expect } from '@playwright/test';
import { mockRadioBrowser, stubBrowserApis, stations, deepLinkOnly, HEALTHY_COUNT, XSS } from './fixtures.js';

/** Boot the app with mocked API + browser stubs and wait for the list to render. */
async function boot(page, { autoplayBlocked = false, url = '/' } = {}) {
  await stubBrowserApis(page, { autoplayBlocked });
  await mockRadioBrowser(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.station-card').first()).toBeVisible();
}

// ─── Flow 1: initial load ─────────────────────────────────────────────────────
test.describe('initial load', () => {
  test('shows station count, cards, populated filters and a globe', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#station-count')).toHaveText(`${HEALTHY_COUNT} stations`);
    await expect(page.locator('.station-card')).toHaveCount(HEALTHY_COUNT);
    // Country filter is populated with options (beyond the "All countries" default).
    expect(await page.locator('#filter-country option').count()).toBeGreaterThan(1);
    await expect(page.locator('#globe-container canvas')).toBeVisible();
  });
});

// ─── Flow 2: filtering & search ───────────────────────────────────────────────
test.describe('filtering and search', () => {
  test('country filter narrows the list and clears again', async ({ page }) => {
    await boot(page);
    await page.selectOption('#filter-country', 'GB');
    await expect(page.locator('.station-card')).toHaveCount(2); // London Pop, Manchester Rock
    await page.click('#clear-filters');
    await expect(page.locator('.station-card')).toHaveCount(HEALTHY_COUNT);
  });

  test('favorites-only with no favorites shows the empty state', async ({ page }) => {
    // Cross-filtering keeps the dropdowns from ever producing an empty result,
    // so the reachable empty state is favorites-only before anything is starred.
    await boot(page);
    await page.click('#favorites-toggle');
    await expect(page.locator('.station-card')).toHaveCount(0);
    await expect(page.locator('#list-empty')).toBeVisible();
  });

  test('search finds a station and reports no results for gibberish', async ({ page }) => {
    await boot(page);
    await page.click('#search-btn');
    await expect(page.locator('#search-modal')).toBeVisible();

    await page.fill('#search-input', 'manchester');
    await expect(page.locator('.search-result-item')).toHaveCount(1);
    await expect(page.locator('.search-result-item')).toContainText('Manchester Rock');

    await page.fill('#search-input', 'zzzznomatch');
    await expect(page.locator('#search-results')).toContainText('No results found');
  });
});

// ─── Flow 3: playback ─────────────────────────────────────────────────────────
test.describe('playback', () => {
  test('selecting a station opens the player, sets the audio URL and the ?station= link', async ({ page }) => {
    await boot(page);
    const first = stations[0]; // London Pop
    await page.locator(`.station-card[data-uuid="${first.stationuuid}"]`).click();

    await expect(page.locator('#player')).toBeVisible();
    await expect(page.locator('#player-name')).toHaveText(first.name);
    await expect(page.locator('#audio-el')).toHaveJSProperty('src', first.url_resolved);
    await expect(page).toHaveURL(new RegExp(`[?&]station=${first.stationuuid}`));
  });
});

// ─── Flow 4: deep links ───────────────────────────────────────────────────────
test.describe('deep links', () => {
  test('opens a station already in the loaded set', async ({ page }) => {
    await boot(page, { url: `/?station=${stations[2].stationuuid}` }); // Paris Jazz
    await expect(page.locator('#player-name')).toHaveText('Paris Jazz');
  });

  test('resolves and opens a station fetched separately by UUID', async ({ page }) => {
    await boot(page, { url: `/?station=${deepLinkOnly.stationuuid}` });
    await expect(page.locator('#player-name')).toHaveText('Deep Link Only');
    // It was injected into the list too.
    await expect(page.locator(`.station-card[data-uuid="${deepLinkOnly.stationuuid}"]`)).toBeVisible();
  });

  test('shows the autoplay prompt when the browser blocks autoplay, then plays on click', async ({ page }) => {
    await boot(page, { autoplayBlocked: true, url: `/?station=${stations[0].stationuuid}` });
    await expect(page.locator('#autoplay-modal')).toBeVisible();
    await expect(page.locator('#autoplay-station-name')).toHaveText('London Pop');

    await page.click('#autoplay-play'); // the click is the user gesture → plays
    await expect(page.locator('#autoplay-modal')).toBeHidden();
    await expect(page.locator('#player-name')).toHaveText('London Pop');
  });
});

// ─── Flow 5: persistence ──────────────────────────────────────────────────────
test.describe('persistence across reload', () => {
  test('a favorited station stays favorited', async ({ page }) => {
    await boot(page);
    const uuid = stations[0].stationuuid;
    const favBtn = page.locator(`.station-card[data-uuid="${uuid}"] .card-fav-btn`);
    await favBtn.click();
    await expect(favBtn).toHaveClass(/active/);

    await page.reload();
    await expect(page.locator('.station-card').first()).toBeVisible();
    await expect(page.locator(`.station-card[data-uuid="${uuid}"] .card-fav-btn`)).toHaveClass(/active/);
  });

  test('a theme choice survives a reload', async ({ page }) => {
    await boot(page);
    const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.click('#theme-toggle');
    const toggled = initial === 'dark' ? 'light' : 'dark';
    await expect(page.locator('html')).toHaveAttribute('data-theme', toggled);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', toggled);
  });
});

// ─── Security regression: hostile upstream metadata ───────────────────────────
test.describe('security', () => {
  test('markup in station metadata is inert (no injected script or handler fires)', async ({ page }) => {
    await boot(page);

    // The hostile station rendered as an ordinary, escaped card.
    const hostile = page.locator('.station-card[data-uuid="hostile-1"]');
    await expect(hostile).toBeVisible();
    // Its name is shown as literal text, not parsed into an <img>/<script>.
    await expect(hostile.locator('.card-name')).toContainText('<img');
    expect(await hostile.locator('script').count()).toBe(0);

    // Surface the hostile station through search too.
    await page.click('#search-btn');
    await page.fill('#search-input', 'evil');
    await expect(page.locator('.search-result-item')).toHaveCount(1);

    // The injection payload never executed anywhere on the page.
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // No stray element carries the payload's marker attribute value.
    expect(await page.locator('[onerror*="__xss"]').count()).toBe(0);
    // Sanity: our XSS fixture really does contain executable-looking markup.
    expect(XSS).toContain('onerror');
  });
});

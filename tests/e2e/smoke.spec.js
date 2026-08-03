import { test, expect } from '@playwright/test';
import { mockRadioBrowser, stubBrowserApis, HEALTHY_COUNT } from './fixtures.js';

test('app boots, globe initialises, and stations render', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await stubBrowserApis(page);
  await mockRadioBrowser(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Station count reflects the fixture set once loaded.
  await expect(page.locator('#station-count')).toHaveText(`${HEALTHY_COUNT} stations`);
  // Cards rendered.
  await expect(page.locator('.station-card')).toHaveCount(HEALTHY_COUNT);
  // Globe canvas mounted (WebGL initialised without throwing).
  await expect(page.locator('#globe-container canvas')).toBeVisible();
  // No uncaught page errors during boot.
  expect(errors).toEqual([]);
});

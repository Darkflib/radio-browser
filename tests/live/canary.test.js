import { describe, it, expect, beforeAll } from 'vitest';
// Reuse the app's real health filter so the canary can't drift from the
// contract it's meant to validate.
import { isHealthy } from '../../src/api.js';

/**
 * Advisory live canary — hits the real radio-browser mirrors.
 *
 * ADVISORY ONLY. This never gates a merge (see vitest.live.config.js and the
 * scheduled CI job). It asserts the service contract still holds, NOT that any
 * particular station exists or plays.
 */

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

async function firstResponsiveMirror() {
  for (const host of MIRRORS) {
    try {
      const res = await fetch(`${host}/json/stats`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return host;
    } catch { /* try next */ }
  }
  return null;
}

describe('live radio-browser canary (advisory)', () => {
  // Resolve a responsive mirror once and reuse it, so the two tests don't each
  // re-probe (which could push worst-case timing past the suite testTimeout).
  let host;
  beforeAll(async () => {
    host = await firstResponsiveMirror();
  });

  it('at least one mirror responds with valid JSON', async () => {
    expect(host, 'no configured mirror responded').not.toBeNull();
    const res = await fetch(`${host}/json/stats`, { signal: AbortSignal.timeout(8000) });
    expect(res.ok).toBe(true);
    const stats = await res.json();
    expect(stats).toBeTypeOf('object'); // parseable JSON
  });

  it('some returned records pass the app health filter', async () => {
    expect(host, 'no configured mirror responded').not.toBeNull();
    const res = await fetch(
      `${host}/json/stations/search?order=clickcount&reverse=true&limit=500&hidebroken=true`,
      { signal: AbortSignal.timeout(20000) },
    );
    expect(res.ok).toBe(true);
    const raw = await res.json();
    expect(Array.isArray(raw)).toBe(true);
    // Contract check: a non-trivial fraction survives the filter. Not a count of
    // any specific station — just that the app would reach a populated state.
    const healthy = raw.filter(isHealthy);
    expect(healthy.length).toBeGreaterThan(0);
  });
});

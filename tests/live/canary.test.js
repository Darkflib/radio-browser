import { describe, it, expect } from 'vitest';

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

// The health filter the app applies (kept in sync with src/api.js by intent).
const KNOWN_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC', 'OPUS', 'HLS', 'MP3,AAC+', 'AAC,MP3']);
function isHealthy(s) {
  if (!s.url_resolved?.startsWith('https://')) return false;
  if (!KNOWN_CODECS.has(s.codec?.toUpperCase())) return false;
  const lat = parseFloat(s.geo_lat), lng = parseFloat(s.geo_long);
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

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
  it('at least one mirror responds with valid JSON', async () => {
    const host = await firstResponsiveMirror();
    expect(host, 'no configured mirror responded').not.toBeNull();
    const res = await fetch(`${host}/json/stats`, { signal: AbortSignal.timeout(8000) });
    expect(res.ok).toBe(true);
    const stats = await res.json();
    expect(stats).toBeTypeOf('object'); // parseable JSON
  });

  it('some returned records pass the app health filter', async () => {
    const host = await firstResponsiveMirror();
    expect(host).not.toBeNull();
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

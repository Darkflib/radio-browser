import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rawHealthy,
  rawNonHttps,
  rawNoUrl,
  rawBadCodec,
  rawNoCoords,
  rawNaNCoords,
  rawZeroZero,
  rawOutOfRange,
  rawMalformed,
  rawHostile,
  rawNumericText,
  rawBatch,
} from '../fixtures/stations.js';

// api.js caches the resolved host in a module-level memo, so reset the module
// (and storage) between tests to keep them independent.
let api;
beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.unstubAllGlobals();
  api = await import('../../src/api.js');
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Storage / cache keys (mirrors api.js constants) ──────────────────────────
const HOST_KEY = 'radio_browser_host_v1';
const STATIONS_KEY = 'radio_browser_stations_v2';
const A_HOST = 'https://de1.api.radio-browser.info';

const DAY = 24 * 60 * 60 * 1000;

function seedFreshHost(host = A_HOST) {
  localStorage.setItem(HOST_KEY, JSON.stringify({ host, timestamp: Date.now() }));
}
function seedStationCache(stations, ageMs = 0) {
  localStorage.setItem(
    STATIONS_KEY,
    JSON.stringify({ version: 2, timestamp: Date.now() - ageMs, stations }),
  );
}

// ─── fetch mock helpers ───────────────────────────────────────────────────────
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[k] ?? headers[String(k).toLowerCase()] ?? null },
    json: async () => body,
  };
}

/**
 * Install a URL-aware fetch mock. `data` handles the station endpoints
 * (search/byuuid); `stats` handles the host-probe endpoint (default: OK).
 */
function installFetch({ data, stats } = {}) {
  const fn = vi.fn(async url => {
    const u = String(url);
    if (u.includes('/json/stats')) {
      return (stats ?? (() => jsonResponse({ supported_version: 1 })))(u);
    }
    return data(u);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const dataCalls = fn => fn.mock.calls.filter(c => !String(c[0]).includes('/json/stats'));
const statsCalls = fn => fn.mock.calls.filter(c => String(c[0]).includes('/json/stats'));

// Drive an operation that sleeps between retries to completion under fake timers.
async function withBackoff(run) {
  vi.useFakeTimers();
  const promise = run();
  const settled = promise.then(v => ({ ok: true, v }), e => ({ ok: false, e }));
  await vi.runAllTimersAsync();
  return settled;
}

// ─── Cache behaviour ──────────────────────────────────────────────────────────
describe('fetchStations — cache', () => {
  it('returns a fresh cache immediately without fetching', async () => {
    const cached = rawBatch(3).map(r => ({ uuid: r.stationuuid }));
    seedStationCache(cached, 0);
    const fetchFn = installFetch({ data: () => { throw new Error('should not fetch'); } });

    const result = await api.fetchStations();
    expect(result).toEqual(cached);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports the cache hit via onProgress', async () => {
    seedStationCache([{ uuid: 'x' }], 0);
    installFetch({ data: () => { throw new Error('nope'); } });
    const onProgress = vi.fn();
    await api.fetchStations(onProgress);
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('cache'));
  });

  it('force: true bypasses a fresh cache and re-fetches', async () => {
    seedStationCache([{ uuid: 'stale-but-fresh' }], 0);
    seedFreshHost();
    const fetchFn = installFetch({ data: () => jsonResponse(rawBatch(4)) });

    const result = await api.fetchStations(undefined, { force: true });
    expect(dataCalls(fetchFn).length).toBe(1);
    expect(result).toHaveLength(4);
    expect(result[0]).toHaveProperty('url'); // normalised, not the raw cache
  });

  it('uses a stale cache when the refresh fails', async () => {
    const stale = [{ uuid: 'day-old', url: 'https://x' }];
    seedStationCache(stale, 25 * 60 * 60 * 1000); // older than the 24h TTL
    seedFreshHost();
    installFetch({ data: () => Promise.reject(new TypeError('network down')) });

    const { ok, v } = await withBackoff(() => api.fetchStations());
    expect(ok).toBe(true);
    expect(v).toEqual(stale); // fell back to the stale copy rather than throwing
  });

  it('a successful refresh replaces the cached data', async () => {
    seedStationCache([{ uuid: 'old' }], 25 * 60 * 60 * 1000);
    seedFreshHost();
    installFetch({ data: () => jsonResponse(rawBatch(5)) });

    const before = Date.now();
    const result = await api.fetchStations();
    expect(result).toHaveLength(5);

    const written = JSON.parse(localStorage.getItem(STATIONS_KEY));
    expect(written.stations).toHaveLength(5);
    expect(written.stations[0].uuid).toBe('uuid-batch-0');
    expect(written.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('ignores a corrupt station cache and fetches fresh', async () => {
    localStorage.setItem(STATIONS_KEY, '{ not valid json');
    seedFreshHost();
    const fetchFn = installFetch({ data: () => jsonResponse(rawBatch(2)) });

    const result = await api.fetchStations();
    expect(result).toHaveLength(2);
    expect(dataCalls(fetchFn).length).toBe(1);
  });

  it('ignores a schema-incompatible station cache (stations not an array)', async () => {
    localStorage.setItem(STATIONS_KEY, JSON.stringify({ version: 2, timestamp: Date.now(), stations: 'nope' }));
    seedFreshHost();
    installFetch({ data: () => jsonResponse(rawBatch(1)) });
    const result = await api.fetchStations();
    expect(result).toHaveLength(1); // corrupt cache skipped
  });
});

// ─── Retry / backoff / rate-limit policy ──────────────────────────────────────
describe('fetchStations — retry policy', () => {
  it('retries transient network errors only within the limit, then falls through', async () => {
    seedFreshHost();
    const fetchFn = installFetch({ data: () => Promise.reject(new TypeError('boom')) });

    const { ok } = await withBackoff(() => api.fetchStations());
    expect(ok).toBe(false); // no cache to fall back to → rejects
    // fetchJson retries=2 → 3 attempts per host; apiGet re-probes once → 2 hosts.
    expect(dataCalls(fetchFn).length).toBe(6);
  });

  it('retries 5xx responses (server errors are transient)', async () => {
    seedFreshHost();
    const fetchFn = installFetch({ data: () => jsonResponse({}, { status: 503 }) });

    const { ok } = await withBackoff(() => api.fetchStations());
    expect(ok).toBe(false);
    expect(dataCalls(fetchFn).length).toBe(6); // 3 attempts × 2 hosts
  });

  it('does NOT retry a 429 and does NOT re-probe (honours back-off)', async () => {
    seedFreshHost();
    const fetchFn = installFetch({
      data: () => jsonResponse({}, { status: 429, headers: { 'Retry-After': '30' } }),
    });

    const { ok } = await withBackoff(() => api.fetchStations());
    expect(ok).toBe(false);
    expect(dataCalls(fetchFn).length).toBe(1); // one shot, no retry, no re-probe
    expect(statsCalls(fetchFn).length).toBe(0);
  });

  it('does NOT retry a non-429 4xx per request, but re-probes one mirror', async () => {
    seedFreshHost();
    const fetchFn = installFetch({ data: () => jsonResponse({}, { status: 404 }) });

    const { ok } = await withBackoff(() => api.fetchStations());
    expect(ok).toBe(false);
    // No per-request retry (1 attempt each), but the cached host failing triggers
    // exactly one mirror re-probe → 2 data calls, 1 stats call.
    expect(dataCalls(fetchFn).length).toBe(2);
    expect(statsCalls(fetchFn).length).toBe(1);
  });

  it('re-probes a fresh mirror when the cached host is unresponsive, then succeeds', async () => {
    seedFreshHost();
    let attempt = 0;
    const fetchFn = installFetch({
      data: () => {
        attempt++;
        // Exhaust the cached host's retries (3 attempts) so apiGet re-probes,
        // then let the fresh mirror succeed.
        if (attempt <= 3) return Promise.reject(new TypeError('cached host down'));
        return jsonResponse(rawBatch(3));
      },
    });

    const { ok, v } = await withBackoff(() => api.fetchStations());
    expect(ok).toBe(true);
    expect(v).toHaveLength(3);
    expect(dataCalls(fetchFn).length).toBe(4); // 3 failed + 1 on the fresh mirror
    expect(statsCalls(fetchFn).length).toBe(1); // exactly one re-probe
  });
});

// ─── Host resolution / probing ────────────────────────────────────────────────
describe('host resolution', () => {
  it('probes when no host is cached', async () => {
    const fetchFn = installFetch({ data: () => jsonResponse(rawBatch(1)) });
    await api.fetchStations();
    expect(statsCalls(fetchFn).length).toBeGreaterThanOrEqual(1);
  });

  it('ignores a host cache entry that is not a known mirror', async () => {
    localStorage.setItem(HOST_KEY, JSON.stringify({ host: 'https://evil.example.com', timestamp: Date.now() }));
    const fetchFn = installFetch({ data: () => jsonResponse(rawBatch(1)) });
    await api.fetchStations();
    // Untrusted host rejected → falls back to probing the known mirrors.
    expect(statsCalls(fetchFn).length).toBeGreaterThanOrEqual(1);
  });

  it('ignores an expired host cache entry', async () => {
    localStorage.setItem(HOST_KEY, JSON.stringify({ host: A_HOST, timestamp: Date.now() - 13 * 60 * 60 * 1000 }));
    const fetchFn = installFetch({ data: () => jsonResponse(rawBatch(1)) });
    await api.fetchStations();
    expect(statsCalls(fetchFn).length).toBeGreaterThanOrEqual(1); // re-probed
  });

  it('reuses a fresh cached host without probing', async () => {
    seedFreshHost();
    const fetchFn = installFetch({ data: () => jsonResponse(rawBatch(1)) });
    await api.fetchStations();
    expect(statsCalls(fetchFn).length).toBe(0);
  });
});

// ─── Health filter (via the public download path) ─────────────────────────────
describe('health filter', () => {
  it('keeps only HTTPS + known-codec + valid-coordinate stations', async () => {
    seedFreshHost();
    const mixed = [
      rawHealthy, rawMalformed, rawHostile, // healthy
      rawNonHttps, rawNoUrl, rawBadCodec,   // broken
      rawNoCoords, rawNaNCoords, rawZeroZero, rawOutOfRange,
    ];
    installFetch({ data: () => jsonResponse(mixed) });

    const result = await api.fetchStations(undefined, { force: true });
    expect(result.map(s => s.uuid).sort()).toEqual(
      ['uuid-healthy-1', 'uuid-hostile', 'uuid-malformed'].sort(),
    );
  });

  it('a record with non-string name/codec is handled per-record, not fatally', async () => {
    seedFreshHost();
    // A numeric codec must be rejected (not throw in isHealthy); a numeric name
    // on an otherwise-healthy record must normalise (not throw on .trim()).
    const numericCodec = { ...rawHealthy, stationuuid: 'uuid-numcodec', codec: 128 };
    const numericName = { ...rawHealthy, stationuuid: 'uuid-numname', name: 12345 };
    installFetch({ data: () => jsonResponse([numericCodec, numericName, rawHealthy]) });

    const result = await api.fetchStations(undefined, { force: true });
    expect(result.map(s => s.uuid).sort()).toEqual(['uuid-healthy-1', 'uuid-numname']);
    expect(result.find(s => s.uuid === 'uuid-numname').name).toBe('12345');
  });
});

// ─── Normalisation ────────────────────────────────────────────────────────────
describe('fetchStationByUuid — normalisation', () => {
  function stubByUuid(raw) {
    seedFreshHost();
    return installFetch({ data: () => jsonResponse(Array.isArray(raw) ? raw : [raw]) });
  }

  it('normalises a healthy station (trim name, upper-case codec, numbers)', async () => {
    stubByUuid(rawHealthy);
    const s = await api.fetchStationByUuid('uuid-healthy-1');
    expect(s).toMatchObject({
      uuid: 'uuid-healthy-1',
      name: 'BBC Radio 1',       // trimmed
      url: 'https://stream.example.com/bbc1',
      codec: 'MP3',              // upper-cased
      bitrate: 128,
      country: 'United Kingdom',
      votes: 4200,
      clicks: 9001,
    });
    expect(s.lat).toBeCloseTo(51.5);
    expect(s.lng).toBeCloseTo(-0.12);
  });

  it('handles null/malformed fields safely', async () => {
    stubByUuid(rawMalformed);
    const s = await api.fetchStationByUuid('uuid-malformed');
    expect(s).toMatchObject({
      name: 'Unknown Station', // null name → default
      codec: 'AAC',
      bitrate: 0,
      country: '',
      countrycode: '',
      language: '',
      tags: '',
      favicon: '',
      votes: 0,
      clicks: 0,
    });
    expect(s.lat).toBeCloseTo(40.4);
  });

  it('coerces EVERY text field to a string, even when upstream sends numbers', async () => {
    stubByUuid(rawNumericText);
    const s = await api.fetchStationByUuid('uuid-numeric-text');
    // Regression: country/countrycode/language/tags/favicon were previously left
    // as raw truthy values, so a numeric one crashed downstream .toLowerCase()/
    // .split(',') in filtering and search.
    for (const field of ['name', 'codec', 'country', 'countrycode', 'language', 'tags', 'favicon']) {
      expect(typeof s[field], `${field} should be a string`).toBe('string');
    }
    expect(s.country).toBe('44');
    expect(s.tags).toBe('2000');
    // And the downstream string operations no longer throw on it.
    expect(() => s.tags.toLowerCase().split(',')).not.toThrow();
    expect(() => s.country.toLowerCase()).not.toThrow();
  });

  it('coerces hostile numeric fields to finite numbers (tooltip-injection guard)', async () => {
    stubByUuid(rawHostile);
    const s = await api.fetchStationByUuid('uuid-hostile');
    // Numeric fields must not survive as injectable strings.
    for (const field of ['bitrate', 'votes', 'clicks']) {
      expect(typeof s[field]).toBe('number');
      expect(Number.isFinite(s[field])).toBe(true);
    }
    expect(s.bitrate).toBe(0); // '48"><img …>' → NaN → 0
    // Text fields are preserved verbatim as inert strings (escaped at render).
    expect(typeof s.name).toBe('string');
    expect(s.name).toContain('<img');
  });
});

// ─── fetchStationByUuid — resolution & failure ────────────────────────────────
describe('fetchStationByUuid — resolution', () => {
  it('returns null for a falsy uuid without fetching', async () => {
    const fetchFn = installFetch({ data: () => jsonResponse([rawHealthy]) });
    expect(await api.fetchStationByUuid('')).toBeNull();
    expect(await api.fetchStationByUuid(undefined)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('URL-encodes the uuid path segment', async () => {
    seedFreshHost();
    const fetchFn = installFetch({ data: () => jsonResponse([rawHealthy]) });
    await api.fetchStationByUuid('foo/bar baz');
    const call = dataCalls(fetchFn).find(c => String(c[0]).includes('/byuuid/'));
    expect(String(call[0])).toContain('/byuuid/foo%2Fbar%20baz');
  });

  it('returns null when the station is not found (empty array)', async () => {
    seedFreshHost();
    installFetch({ data: () => jsonResponse([]) });
    expect(await api.fetchStationByUuid('missing')).toBeNull();
  });

  it('returns null when the resolved station is unhealthy', async () => {
    seedFreshHost();
    installFetch({ data: () => jsonResponse([rawNonHttps]) });
    expect(await api.fetchStationByUuid('uuid-http')).toBeNull();
  });

  it('re-probes once and returns null when the lookup keeps failing', async () => {
    seedFreshHost();
    const fetchFn = installFetch({ data: () => Promise.reject(new TypeError('down')) });

    const { v } = await withBackoff(() => api.fetchStationByUuid('uuid-x'));
    expect(v).toBeNull();
    expect(statsCalls(fetchFn).length).toBe(1); // exactly one mirror re-probe
  });
});

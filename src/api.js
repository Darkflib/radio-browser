/**
 * Radio Browser API
 *
 * Fetches the top stations (by click count) and filters for healthy ones.
 * radio-browser.info is a donated community service, so this module is written
 * to be gentle on it and resilient to throttling:
 *  - the normalised station set is cached in localStorage for 24h;
 *  - the working API host is cached too, so we stop re-probing /json/stats;
 *  - requests are "simple" (no custom headers) to avoid a CORS preflight that
 *    would double every call;
 *  - 429/4xx responses are not retried (we honour Retry-After instead of
 *    hammering), and on any refresh failure we fall back to the last cached
 *    copy — even if it's stale — so the app still loads.
 */

const KNOWN_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC', 'OPUS', 'HLS', 'MP3,AAC+', 'AAC,MP3']);
const API_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fisher–Yates shuffle so we don't always hammer the same server first
// (radio-browser asks clients to spread load across mirrors).
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Thrown on HTTP 429 so callers can fall back to cache rather than retrying. */
class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limited by radio-browser API');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Fetch a URL as a "simple" request (no custom headers → no CORS preflight),
 * with bounded retries. Retries only transient failures (network errors,
 * timeouts, 5xx). A 429 throws RateLimitError immediately (no hammering); other
 * 4xx throw without retrying since a retry won't help.
 */
async function fetchJson(url, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch (err) {
      lastError = err; // network error / timeout — retryable
      if (attempt < retries) { await sleep(800 * 2 ** attempt); continue; }
      throw err;
    }

    if (res.ok) return res;

    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After'));
      throw new RateLimitError(Number.isFinite(ra) ? ra : null);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`HTTP ${res.status}`); // client error — don't retry
    }

    lastError = new Error(`HTTP ${res.status}`); // 5xx — retryable
    if (attempt < retries) { await sleep(800 * 2 ** attempt); continue; }
    throw lastError;
  }
  throw lastError;
}

// ─── Host resolution (cached) ──────────────────────────────────────────────────
const HOST_CACHE_KEY = 'radio_browser_host_v1';
const HOST_TTL = 12 * 60 * 60 * 1000; // 12 hours
let resolvedHost = null; // in-memory memo for the session

function readHostCache() {
  try {
    const raw = localStorage.getItem(HOST_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !API_HOSTS.includes(data.host)) return null;
    if (Date.now() - data.timestamp > HOST_TTL) return null;
    return data.host;
  } catch {
    return null;
  }
}

function writeHostCache(host) {
  try {
    localStorage.setItem(HOST_CACHE_KEY, JSON.stringify({ host, timestamp: Date.now() }));
  } catch { /* best-effort */ }
}

/** Probe hosts (in random order) and return the first responsive one. */
async function probeApiHost() {
  for (const host of shuffled(API_HOSTS)) {
    try {
      const res = await fetch(`${host}/json/stats`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return host;
    } catch { /* try next */ }
  }
  return API_HOSTS[0];
}

/**
 * Get a working API host, reusing the cached choice (in-memory, then
 * localStorage) so we don't re-probe /json/stats on every call. Pass
 * { force: true } to bypass the cache and re-probe.
 */
async function getApiHost({ force = false } = {}) {
  if (!force) {
    if (resolvedHost) return resolvedHost;
    const cached = readHostCache();
    if (cached) { resolvedHost = cached; return cached; }
  }
  const host = await probeApiHost();
  resolvedHost = host;
  writeHostCache(host);
  return host;
}

function invalidateHost() {
  resolvedHost = null;
  try { localStorage.removeItem(HOST_CACHE_KEY); } catch { /* ignore */ }
}

/**
 * Is a station "healthy"?
 * - Must use HTTPS stream URL
 * - Must have a known codec
 * - Must have valid lat/lng coordinates
 */
function isHealthy(station) {
  if (!station.url_resolved?.startsWith('https://')) return false;
  if (!KNOWN_CODECS.has(station.codec?.toUpperCase())) return false;
  const lat = parseFloat(station.geo_lat);
  const lng = parseFloat(station.geo_long);
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

/** Coerce a value to a finite number, defaulting to 0 for junk/missing data. */
function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalise raw station data to a consistent shape.
 *
 * Numeric fields are coerced to finite numbers so a hostile/malformed upstream
 * value (e.g. bitrate: '48"><img onerror=…>') can't survive as a string and be
 * interpolated into markup (the globe hover tooltip renders bitrate unescaped).
 */
function normalise(station) {
  return {
    uuid: station.stationuuid,
    name: (station.name || 'Unknown Station').trim(),
    url: station.url_resolved,
    codec: station.codec?.toUpperCase() || 'MP3',
    bitrate: toFinite(station.bitrate),
    country: station.country || '',
    countrycode: station.countrycode || '',
    language: station.language || '',
    tags: station.tags || '',
    favicon: station.favicon || '',
    lat: parseFloat(station.geo_lat),
    lng: parseFloat(station.geo_long),
    votes: toFinite(station.votes),
    clicks: toFinite(station.clickcount),
  };
}

// Number of raw stations to request. The health filter (HTTPS + known codec +
// valid coordinates) only keeps ~18% of them, so we over-fetch to end up with a
// well-populated globe (~1800 healthy stations from 10k raw).
const FETCH_LIMIT = 10000;

// ─── Browser cache ────────────────────────────────────────────────────────────
// Persist the normalised healthy stations in localStorage so repeat visits load
// instantly without re-downloading and re-filtering the full dataset.
const CACHE_KEY = 'radio_browser_stations_v2';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Raw cache entry ({ version, timestamp, stations }) ignoring freshness.
function readCacheRaw() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.stations) || !data.stations.length) return null;
    return data;
  } catch {
    return null;
  }
}

// Fresh (within-TTL) cached stations, or null.
function readCache() {
  const data = readCacheRaw();
  if (!data) return null;
  if (Date.now() - data.timestamp > CACHE_TTL) return null;
  return data.stations;
}

function writeCache(stations) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: 2, timestamp: Date.now(), stations })
    );
  } catch {
    // Quota exceeded or serialization failure — caching is best-effort.
  }
}

/**
 * GET a path against the current API host, re-probing a fresh mirror once if the
 * request fails for a non-rate-limit reason (the cached host may have gone down).
 * A 429 propagates without re-probing — that's a back-off signal, not a bad host.
 */
async function apiGet(path, opts) {
  try {
    return await fetchJson(`${await getApiHost()}${path}`, opts);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    invalidateHost();
    return await fetchJson(`${await getApiHost({ force: true })}${path}`, opts);
  }
}

/** Download + filter the top stations from the API (no caching). */
async function downloadStations(onProgress) {
  const path = `/json/stations/search?order=clickcount&reverse=true&limit=${FETCH_LIMIT}&hidebroken=true`;

  onProgress?.('Connecting to radio-browser.info…');
  const res = await apiGet(path);

  onProgress?.('Parsing station data…');
  const raw = await res.json();

  onProgress?.('Filtering healthy stations…');
  return raw.filter(isHealthy).map(normalise);
}

/**
 * Fetch the top stations by click count and return normalised healthy stations.
 *
 * Results are cached in localStorage for 24h; pass { force: true } to bypass the
 * cache and re-fetch. If the network fetch fails (including rate limiting), we
 * fall back to the last cached copy even if it's stale, so the app still loads.
 */
export async function fetchStations(onProgress, { force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) {
      onProgress?.(`Loaded ${cached.length} stations from cache`);
      return cached;
    }
  }

  try {
    const stations = await downloadStations(onProgress);
    writeCache(stations);
    return stations;
  } catch (err) {
    // Stale-while-error: better a day-old list than a blank app.
    const stale = readCacheRaw();
    if (stale?.stations?.length) {
      onProgress?.(`Using cached stations (couldn't refresh)`);
      return stale.stations;
    }
    throw err;
  }
}

/**
 * Resolve a single station by its UUID (for shared deep-links whose station
 * isn't in the cached top set). Returns a normalised station, or null if it
 * can't be found or isn't playable/placeable (no HTTPS stream or coordinates).
 */
export async function fetchStationByUuid(uuid) {
  if (!uuid) return null;
  try {
    const res = await apiGet(`/json/stations/byuuid/${encodeURIComponent(uuid)}`, { retries: 1 });
    const arr = await res.json();
    const raw = Array.isArray(arr) ? arr[0] : null;
    if (!raw || !isHealthy(raw)) return null;
    return normalise(raw);
  } catch {
    return null;
  }
}

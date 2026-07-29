/**
 * Radio Browser API
 * Fetches top 1500 stations and filters for healthy ones.
 */

const KNOWN_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC', 'OPUS', 'HLS', 'MP3,AAC+', 'AAC,MP3']);
const API_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

/**
 * Fetch with retry (up to maxAttempts tries).
 */
async function fetchWithRetry(url, options = {}, maxAttempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Pick a working API host.
 */
async function resolveApiHost() {
  for (const host of API_HOSTS) {
    try {
      const res = await fetch(`${host}/json/stats`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return host;
    } catch { /* try next */ }
  }
  return API_HOSTS[0];
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

/**
 * Normalise raw station data to a consistent shape.
 */
function normalise(station) {
  return {
    uuid: station.stationuuid,
    name: (station.name || 'Unknown Station').trim(),
    url: station.url_resolved,
    codec: station.codec?.toUpperCase() || 'MP3',
    bitrate: station.bitrate || 0,
    country: station.country || '',
    countrycode: station.countrycode || '',
    language: station.language || '',
    tags: station.tags || '',
    favicon: station.favicon || '',
    lat: parseFloat(station.geo_lat),
    lng: parseFloat(station.geo_long),
    votes: station.votes || 0,
    clicks: station.clickcount || 0,
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

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.stations) || !data.stations.length) return null;
    if (Date.now() - data.timestamp > CACHE_TTL) return null;
    return data.stations;
  } catch {
    return null;
  }
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
 * Fetch the top stations by click count and return normalised healthy stations.
 *
 * Results are cached in localStorage for 24h; pass { force: true } to bypass the
 * cache and re-fetch fresh data.
 */
export async function fetchStations(onProgress, { force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) {
      onProgress?.(`Loaded ${cached.length} stations from cache`);
      return cached;
    }
  }

  const host = await resolveApiHost();
  const url = `${host}/json/stations/search?order=clickcount&reverse=true&limit=${FETCH_LIMIT}&hidebroken=true`;

  onProgress?.('Connecting to radio-browser.info…');

  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': 'RadioBrowserApp/1.0', 'Content-Type': 'application/json' },
  });

  onProgress?.('Parsing station data…');
  const raw = await res.json();

  onProgress?.('Filtering healthy stations…');
  const healthy = raw.filter(isHealthy).map(normalise);

  writeCache(healthy);

  return healthy;
}

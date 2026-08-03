/**
 * Reusable station fixtures.
 *
 * Two shapes live here:
 *  - `raw*`   : the shape radio-browser returns (stationuuid, url_resolved,
 *               geo_lat, clickcount, …). Feed these to the api.js layer.
 *  - `station()` / normalised lists: the shape api.normalise() produces
 *               (uuid, url, lat, lng, clicks, …). Feed these to store/cluster.
 *
 * The set deliberately covers healthy, broken (fails the health filter),
 * malformed (null/missing fields), clustered (co-located), and hostile-metadata
 * (markup injected into every text/numeric field) records.
 */

// ─── Raw API-shaped records (for api.js) ──────────────────────────────────────

/** A fully healthy raw station: HTTPS, known codec, valid coordinates. */
export const rawHealthy = {
  stationuuid: 'uuid-healthy-1',
  name: '  BBC Radio 1  ',
  url_resolved: 'https://stream.example.com/bbc1',
  codec: 'mp3',
  bitrate: 128,
  country: 'United Kingdom',
  countrycode: 'GB',
  language: 'english',
  tags: 'pop,news',
  favicon: 'https://example.com/bbc.png',
  geo_lat: 51.5,
  geo_long: -0.12,
  votes: 4200,
  clickcount: 9001,
};

/** Broken records — each must be rejected by the health filter. */
export const rawNonHttps = { ...rawHealthy, stationuuid: 'uuid-http', url_resolved: 'http://insecure.example.com/s' };
export const rawNoUrl = { ...rawHealthy, stationuuid: 'uuid-nourl', url_resolved: undefined };
export const rawBadCodec = { ...rawHealthy, stationuuid: 'uuid-codec', codec: 'WMA' };
export const rawNoCoords = { ...rawHealthy, stationuuid: 'uuid-nocoords', geo_lat: null, geo_long: null };
export const rawNaNCoords = { ...rawHealthy, stationuuid: 'uuid-nan', geo_lat: 'not-a-number', geo_long: 'x' };
export const rawZeroZero = { ...rawHealthy, stationuuid: 'uuid-zero', geo_lat: 0, geo_long: 0 };
export const rawOutOfRange = { ...rawHealthy, stationuuid: 'uuid-oor', geo_lat: 120, geo_long: 400 };

/** Healthy but with null/missing optional fields — normalise must not throw. */
export const rawMalformed = {
  stationuuid: 'uuid-malformed',
  name: null,
  url_resolved: 'https://stream.example.com/malformed',
  codec: 'aac',
  bitrate: null,
  country: null,
  countrycode: null,
  language: null,
  tags: null,
  favicon: null,
  geo_lat: '40.4',
  geo_long: '-3.7',
  votes: null,
  clickcount: null,
};

/**
 * Hostile metadata: HTML/JS injected into every text field, and non-numeric
 * junk in every numeric field. It is otherwise healthy so it survives the
 * filter — the point is that normalisation must keep numbers finite and keep
 * text as inert strings (escaping happens at the render layer).
 */
export const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
export const rawHostile = {
  stationuuid: 'uuid-hostile',
  name: XSS,
  url_resolved: 'https://stream.example.com/hostile',
  codec: 'mp3',
  bitrate: `48"><img src=x onerror=alert(1)>`,
  country: XSS,
  countrycode: XSS,
  language: XSS,
  tags: `rock,${XSS}`,
  favicon: 'https://example.com/"onerror="alert(1).png',
  geo_lat: 48.85,
  geo_long: 2.35,
  votes: `10<script>`,
  clickcount: `20"><b>`,
};

/** A big batch of healthy raw stations for over-fetch / filter tests. */
export function rawBatch(n = 20) {
  return Array.from({ length: n }, (_, i) => ({
    ...rawHealthy,
    stationuuid: `uuid-batch-${i}`,
    name: `Station ${i}`,
    geo_lat: 40 + i * 0.5,
    geo_long: -70 + i * 0.5,
    clickcount: 1000 - i,
  }));
}

// ─── Normalised records (for store.js / cluster.js) ───────────────────────────

/** Build a normalised station with sensible defaults; override any field. */
export function station(overrides = {}) {
  return {
    uuid: overrides.uuid ?? `uuid-${Math.round((overrides.lat ?? 0) * 1000)}-${Math.round((overrides.lng ?? 0) * 1000)}`,
    name: 'A Station',
    url: 'https://stream.example.com/s',
    codec: 'MP3',
    bitrate: 128,
    country: 'United Kingdom',
    countrycode: 'GB',
    language: 'english',
    tags: 'pop',
    favicon: '',
    lat: 0,
    lng: 0,
    votes: 0,
    clicks: 0,
    distanceKm: null,
    ...overrides,
  };
}

/**
 * A curated, normalised set for store filtering tests. Countries: GB, US, FR.
 * Codecs include a compound "MP3,AAC+". Genres vary.
 */
export const normalisedStations = [
  station({ uuid: 'gb-pop',   name: 'GB Pop',   country: 'United Kingdom', countrycode: 'GB', codec: 'MP3',      tags: 'pop,top 40',   lat: 51.5,  lng: -0.12 }),
  station({ uuid: 'gb-rock',  name: 'GB Rock',  country: 'United Kingdom', countrycode: 'GB', codec: 'AAC',      tags: 'rock,classic', lat: 53.4,  lng: -2.98 }),
  station({ uuid: 'us-jazz',  name: 'US Jazz',  country: 'United States',  countrycode: 'US', codec: 'MP3,AAC+', tags: 'jazz,blues',   lat: 40.7,  lng: -74.0 }),
  station({ uuid: 'us-news',  name: 'US News',  country: 'United States',  countrycode: 'US', codec: 'AAC+',     tags: 'news,talk',    lat: 34.0,  lng: -118.2 }),
  station({ uuid: 'fr-pop',   name: 'FR Pop',   country: 'France',         countrycode: 'FR', codec: 'OGG',      tags: 'pop,chanson',  lat: 48.85, lng: 2.35 }),
];

// ─── Clustering geometries (normalised) ───────────────────────────────────────

// Two stations ~1km apart (inside the 5km group radius) — should be grouped.
export const coLocatedPair = [
  station({ uuid: 'co-a', lat: 51.5000, lng: -0.1200 }),
  station({ uuid: 'co-b', lat: 51.5080, lng: -0.1200 }), // ~0.9km north
];

// Two stations ~7km apart (outside the 5km group radius) — should stay separate.
export const separatePair = [
  station({ uuid: 'sep-a', lat: 51.5000, lng: -0.1200 }),
  station({ uuid: 'sep-b', lat: 51.5630, lng: -0.1200 }), // ~7km north
];

// A dense stack of co-located stations (more than SPREAD_LIMIT=8) → one cluster.
export const denseStack = Array.from({ length: 12 }, (_, i) =>
  station({ uuid: `dense-${i}`, lat: 40.0 + i * 0.001, lng: -70.0 + i * 0.001 }),
);

// A pair straddling the antimeridian (179.9 vs -179.9) — ~22km apart the short
// way, not ~40,000km the long way.
export const antimeridianPair = [
  station({ uuid: 'am-a', lat: 0, lng: 179.9 }),
  station({ uuid: 'am-b', lat: 0, lng: -179.9 }),
];

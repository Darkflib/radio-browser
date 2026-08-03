/**
 * A compact raw-API station fixture (~12 records) plus a helper that intercepts
 * every radio-browser request so e2e runs are fully deterministic and offline.
 */

export const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1"><script>window.__xss=1</script>';

// Base coordinates for a dense co-located cluster (all within a few hundred m).
const CLUSTER = { lat: 40.7128, long: -74.006 };

/** ~12 raw stations: healthy across countries/genres, a cluster, and a hostile one. */
export const stations = [
  { stationuuid: 'gb-pop-1', name: 'London Pop', url_resolved: 'https://stream.example.com/gb-pop-1', codec: 'MP3', bitrate: 128, country: 'United Kingdom', countrycode: 'GB', language: 'english', tags: 'pop,top 40', favicon: '', geo_lat: 51.5074, geo_long: -0.1278, votes: 1200, clickcount: 5000 },
  { stationuuid: 'gb-rock-1', name: 'Manchester Rock', url_resolved: 'https://stream.example.com/gb-rock-1', codec: 'AAC', bitrate: 96, country: 'United Kingdom', countrycode: 'GB', language: 'english', tags: 'rock,indie', favicon: '', geo_lat: 53.4808, geo_long: -2.2426, votes: 800, clickcount: 4200 },
  { stationuuid: 'fr-jazz-1', name: 'Paris Jazz', url_resolved: 'https://stream.example.com/fr-jazz-1', codec: 'OGG', bitrate: 192, country: 'France', countrycode: 'FR', language: 'french', tags: 'jazz,smooth', favicon: '', geo_lat: 48.8566, geo_long: 2.3522, votes: 640, clickcount: 3900 },
  { stationuuid: 'fr-news-1', name: 'France Info', url_resolved: 'https://stream.example.com/fr-news-1', codec: 'MP3', bitrate: 128, country: 'France', countrycode: 'FR', language: 'french', tags: 'news,talk', favicon: '', geo_lat: 45.7640, geo_long: 4.8357, votes: 900, clickcount: 3600 },
  { stationuuid: 'de-elec-1', name: 'Berlin Electronic', url_resolved: 'https://stream.example.com/de-elec-1', codec: 'MP3,AAC+', bitrate: 256, country: 'Germany', countrycode: 'DE', language: 'german', tags: 'electronic,techno', favicon: '', geo_lat: 52.52, geo_long: 13.405, votes: 1500, clickcount: 6100 },
  { stationuuid: 'jp-pop-1', name: 'Tokyo Pop', url_resolved: 'https://stream.example.com/jp-pop-1', codec: 'AAC', bitrate: 128, country: 'Japan', countrycode: 'JP', language: 'japanese', tags: 'pop,jpop', favicon: '', geo_lat: 35.6762, geo_long: 139.6503, votes: 2000, clickcount: 7000 },
  // A dense co-located cluster in New York (6 stations at nearly the same spot).
  { stationuuid: 'us-ny-1', name: 'NY One', url_resolved: 'https://stream.example.com/us-ny-1', codec: 'MP3', bitrate: 128, country: 'United States', countrycode: 'US', language: 'english', tags: 'pop', favicon: '', geo_lat: CLUSTER.lat, geo_long: CLUSTER.long, votes: 300, clickcount: 3000 },
  { stationuuid: 'us-ny-2', name: 'NY Two', url_resolved: 'https://stream.example.com/us-ny-2', codec: 'AAC', bitrate: 128, country: 'United States', countrycode: 'US', language: 'english', tags: 'rock', favicon: '', geo_lat: CLUSTER.lat + 0.002, geo_long: CLUSTER.long + 0.002, votes: 310, clickcount: 2900 },
  { stationuuid: 'us-ny-3', name: 'NY Three', url_resolved: 'https://stream.example.com/us-ny-3', codec: 'MP3', bitrate: 128, country: 'United States', countrycode: 'US', language: 'english', tags: 'jazz', favicon: '', geo_lat: CLUSTER.lat + 0.001, geo_long: CLUSTER.long - 0.001, votes: 320, clickcount: 2800 },
  { stationuuid: 'us-ny-4', name: 'NY Four', url_resolved: 'https://stream.example.com/us-ny-4', codec: 'MP3', bitrate: 128, country: 'United States', countrycode: 'US', language: 'english', tags: 'news', favicon: '', geo_lat: CLUSTER.lat - 0.001, geo_long: CLUSTER.long + 0.0015, votes: 330, clickcount: 2700 },
  { stationuuid: 'us-ny-5', name: 'NY Five', url_resolved: 'https://stream.example.com/us-ny-5', codec: 'MP3', bitrate: 128, country: 'United States', countrycode: 'US', language: 'english', tags: 'talk', favicon: '', geo_lat: CLUSTER.lat + 0.0005, geo_long: CLUSTER.long + 0.0005, votes: 340, clickcount: 2600 },
  // Hostile metadata — markup in every text field, junk in numeric fields.
  { stationuuid: 'hostile-1', name: `Evil ${XSS}`, url_resolved: 'https://stream.example.com/hostile-1', codec: 'MP3', bitrate: '48"><img src=x onerror="window.__xss=1">', country: XSS, countrycode: XSS, language: XSS, tags: `evil,${XSS}`, favicon: 'https://x/"onerror="window.__xss=1".png', geo_lat: 1.3521, geo_long: 103.8198, votes: '9<script>', clickcount: '3">' },
];

// A station that is NOT in the search set — only resolvable via the byuuid
// endpoint, used to exercise the deep-link "separately fetched UUID" path.
export const deepLinkOnly = {
  stationuuid: 'deep-only-1', name: 'Deep Link Only', url_resolved: 'https://stream.example.com/deep-only-1', codec: 'MP3', bitrate: 128, country: 'Iceland', countrycode: 'IS', language: 'icelandic', tags: 'ambient', favicon: '', geo_lat: 64.1466, geo_long: -21.9426, votes: 10, clickcount: 100,
};

/** Count of stations that survive the app's health filter (all of ours do). */
export const HEALTHY_COUNT = stations.length;

/**
 * Route every radio-browser API call to the fixture. Call before navigation.
 * `overrides` lets a test tweak specific endpoints (e.g. force a byuuid 404).
 */
export async function mockRadioBrowser(page, overrides = {}) {
  // Block external Google Fonts so the page reaches `load` promptly and offline.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());

  await page.route('**://*.api.radio-browser.info/**', async route => {
    const url = route.request().url();
    if (url.includes('/json/stats')) {
      return route.fulfill({ json: { supported_version: 1, stations: stations.length } });
    }
    if (url.includes('/json/stations/byuuid/')) {
      if (overrides.byuuid) return overrides.byuuid(route, url);
      const uuid = decodeURIComponent(url.split('/byuuid/')[1].split('?')[0]);
      const all = [...stations, deepLinkOnly];
      const found = all.find(s => s.stationuuid === uuid);
      return route.fulfill({ json: found ? [found] : [] });
    }
    if (url.includes('/json/stations/search')) {
      if (overrides.search) return overrides.search(route, url);
      return route.fulfill({ json: stations });
    }
    return route.fulfill({ json: [] });
  });
}

/**
 * Install browser-API stubs the app depends on but which don't work headlessly:
 * media playback and the async clipboard. Playback resolves by default; pass
 * { autoplayBlocked: true } to make play() reject like a browser blocking
 * autoplay without a user gesture. (Geolocation and native share aren't stubbed
 * — no current flow exercises them; add stubs here when one does.)
 */
export async function stubBrowserApis(page, { autoplayBlocked = false } = {}) {
  await page.addInitScript(blocked => {
    // Media: never actually load a stream; report play()/pause() outcomes.
    const proto = window.HTMLMediaElement.prototype;
    proto.play = function () {
      if (blocked && !window.__userGesture) {
        const err = new DOMException('blocked', 'NotAllowedError');
        return Promise.reject(err);
      }
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    proto.pause = function () { this.dispatchEvent(new Event('pause')); };
    // A real click on the play button counts as a user gesture.
    document.addEventListener('pointerdown', () => { window.__userGesture = true; }, true);

    // Clipboard + share stubs record what they were asked to do.
    window.__clipboard = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: t => { window.__clipboard = t; return Promise.resolve(); } },
    });
  }, autoplayBlocked);
}

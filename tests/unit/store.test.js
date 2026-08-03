import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalisedStations, station } from '../fixtures/stations.js';

// store.js is a singleton module. Reset its module state (and localStorage)
// before every test so state can't leak between cases.
let store;
beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  store = await import('../../src/store.js');
});

/** Convenience: seed the store with the curated fixture set. */
function seed(list = normalisedStations) {
  store.setStations(list);
  return store.getState();
}

describe('filtering', () => {
  it('filters by country code and by full country name', () => {
    seed();
    store.setFilterCountry('GB');
    expect(store.getState().filtered.map(s => s.uuid).sort()).toEqual(['gb-pop', 'gb-rock']);

    store.setFilterCountry('France'); // full-name match path
    expect(store.getState().filtered.map(s => s.uuid)).toEqual(['fr-pop']);
  });

  it('filters by genre (exact tag component, case-insensitive)', () => {
    seed();
    store.setFilterGenre('pop');
    expect(store.getState().filtered.map(s => s.uuid).sort()).toEqual(['fr-pop', 'gb-pop']);
  });

  it('filters by codec, matching either component of a compound codec', () => {
    seed();
    store.setFilterCodec('AAC+'); // us-jazz is "MP3,AAC+", us-news is "AAC+"
    expect(store.getState().filtered.map(s => s.uuid).sort()).toEqual(['us-jazz', 'us-news']);

    store.setFilterCodec('MP3'); // gb-pop "MP3", us-jazz "MP3,AAC+"
    expect(store.getState().filtered.map(s => s.uuid).sort()).toEqual(['gb-pop', 'us-jazz']);
  });

  it('combines country + genre filters', () => {
    seed();
    store.setFilterCountry('GB');
    store.setFilterGenre('rock');
    expect(store.getState().filtered.map(s => s.uuid)).toEqual(['gb-rock']);
  });

  it('shows only favorites when the favorites filter is on', () => {
    seed();
    store.toggleFavorite('us-jazz');
    store.toggleFavorite('fr-pop');
    store.setShowFavoritesOnly(true);
    expect(store.getState().filtered.map(s => s.uuid).sort()).toEqual(['fr-pop', 'us-jazz']);
  });

  it('yields an empty list when filters match nothing', () => {
    seed();
    store.setFilterCountry('GB');
    store.setFilterGenre('jazz'); // no GB jazz station
    expect(store.getState().filtered).toEqual([]);
  });
});

describe('near-me ordering', () => {
  it('annotates distance and sorts closest-first when enabled', () => {
    seed();
    store.setUserLocation({ lat: 48.85, lng: 2.35 }); // Paris → fr-pop is closest
    store.setNearMe(true);
    const filtered = store.getState().filtered;
    expect(filtered[0].uuid).toBe('fr-pop');
    expect(filtered[0].distanceKm).toBeCloseTo(0, 1);
    // Sorted ascending by distance.
    const dists = filtered.map(s => s.distanceKm);
    expect(dists).toEqual([...dists].sort((a, b) => a - b));
  });

  it('clears stale distance annotations when near-me is disabled', () => {
    seed();
    store.setUserLocation({ lat: 48.85, lng: 2.35 });
    store.setNearMe(true);
    expect(store.getState().filtered.every(s => s.distanceKm != null)).toBe(true);

    store.setNearMe(false);
    expect(store.getState().filtered.every(s => s.distanceKm === null)).toBe(true);
  });

  it('does not sort by distance when near-me is on but location is unknown', () => {
    seed();
    store.setNearMe(true); // no userLocation yet
    expect(store.getState().filtered.map(s => s.uuid)).toEqual(normalisedStations.map(s => s.uuid));
    expect(store.getState().filtered.every(s => s.distanceKm === null)).toBe(true);
  });
});

describe('haversineKm', () => {
  it('is 0 for identical points and symmetric', () => {
    expect(store.haversineKm(50, 10, 50, 10)).toBeCloseTo(0, 6);
    expect(store.haversineKm(51.5, -0.12, 48.85, 2.35))
      .toBeCloseTo(store.haversineKm(48.85, 2.35, 51.5, -0.12), 6);
  });

  it('approximates a known distance (London → Paris ≈ 344km)', () => {
    const d = store.haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });
});

describe('favorites', () => {
  it('toggles membership and reports it', () => {
    seed();
    expect(store.isFavorite('gb-pop')).toBe(false);
    store.toggleFavorite('gb-pop');
    expect(store.isFavorite('gb-pop')).toBe(true);
    store.toggleFavorite('gb-pop');
    expect(store.isFavorite('gb-pop')).toBe(false);
  });

  it('persists favorites to localStorage across a reload', async () => {
    store.toggleFavorite('gb-rock');
    // Re-import the module fresh — it should hydrate favorites from storage.
    vi.resetModules();
    const reloaded = await import('../../src/store.js');
    expect(reloaded.isFavorite('gb-rock')).toBe(true);
  });

  it('ignores a corrupt favorites entry in localStorage', async () => {
    localStorage.setItem('radio_browser_favorites', '{not valid json');
    vi.resetModules();
    const reloaded = await import('../../src/store.js');
    expect(reloaded.isFavorite('anything')).toBe(false); // fell back to empty set
  });

  it('does not throw when the storage write fails (quota/disabled)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => store.toggleFavorite('gb-pop')).not.toThrow();
    // The in-memory state still updated even though persistence failed.
    expect(store.isFavorite('gb-pop')).toBe(true);
    spy.mockRestore();
  });
});

describe('cross-filter option counts', () => {
  it('country options exclude their own filter but respect others', () => {
    seed();
    store.setFilterGenre('pop'); // pop stations: gb-pop (GB), fr-pop (FR)
    const opts = store.getCountryOptions();
    const byCode = Object.fromEntries(opts.map(o => [o.code, o.count]));
    expect(byCode).toEqual({ GB: 1, FR: 1 });
    // Setting a country filter must NOT shrink the country option list.
    store.setFilterCountry('GB');
    expect(store.getCountryOptions().map(o => o.code).sort()).toEqual(['FR', 'GB']);
  });

  it('genre options are cross-filtered by the active country', () => {
    seed();
    store.setFilterCountry('US'); // US stations: jazz,blues + news,talk
    const tags = store.getGenreOptions().map(o => o.tag).sort();
    expect(tags).toEqual(['blues', 'jazz', 'news', 'talk']);
  });

  it('codec options count compound codecs under each component', () => {
    seed();
    const byCodec = Object.fromEntries(store.getCodecOptions().map(o => [o.codec, o.count]));
    // us-jazz "MP3,AAC+" contributes to both MP3 and AAC+.
    expect(byCodec['MP3']).toBe(2);   // gb-pop, us-jazz
    expect(byCodec['AAC+']).toBe(2);  // us-jazz, us-news
    expect(byCodec['AAC']).toBe(1);   // gb-rock
    expect(byCodec['OGG']).toBe(1);   // fr-pop
  });

  it('normalises genre casing/whitespace and caps the list at 200', () => {
    // 250 distinct tags + a too-long (>40 char) tag that must be dropped.
    const many = Array.from({ length: 250 }, (_, i) =>
      station({ uuid: `g${i}`, tags: `  Genre-${i}  `, lat: i * 0.01, lng: 0 }),
    );
    many.push(station({ uuid: 'longtag', tags: 'x'.repeat(41), lat: 5, lng: 5 }));
    store.setStations(many);
    const opts = store.getGenreOptions();
    expect(opts.length).toBe(200); // capped
    // Tags are lower-cased and trimmed.
    expect(opts.every(o => o.tag === o.tag.trim().toLowerCase())).toBe(true);
    expect(opts.some(o => o.tag.length > 40)).toBe(false); // over-long dropped
  });
});

describe('addStationToTop', () => {
  it('prepends a new station and re-applies filters', () => {
    seed();
    const injected = station({ uuid: 'deep-link', name: 'Deep Linked', lat: 1, lng: 1 });
    const returned = store.addStationToTop(injected);
    expect(returned).toBe(injected);
    expect(store.getState().allStations[0].uuid).toBe('deep-link');
    expect(store.getState().filtered[0].uuid).toBe('deep-link');
  });

  it('returns the existing station without duplicating', () => {
    seed();
    const before = store.getState().allStations.length;
    const dupe = station({ uuid: 'gb-pop', name: 'Different Name' });
    const returned = store.addStationToTop(dupe);
    expect(returned.uuid).toBe('gb-pop');
    expect(returned).not.toBe(dupe); // returned the pre-existing object
    expect(store.getState().allStations.length).toBe(before);
  });
});

describe('subscribe', () => {
  it('notifies listeners on change and stops after unsubscribe', () => {
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.setPlaying(true);
    expect(fn).toHaveBeenCalledWith({ type: 'playing' });
    fn.mockClear();
    unsub();
    store.setPlaying(false);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('sleep timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the configured delay, pauses playback and clears itself', () => {
    const fn = vi.fn();
    store.subscribe(fn);
    store.setPlaying(true);
    store.setSleepTimer(15);
    expect(store.getState().sleepTimer).not.toBeNull();

    vi.advanceTimersByTime(15 * 60 * 1000);

    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().sleepTimer).toBeNull();
    expect(fn).toHaveBeenCalledWith({ type: 'sleep' });
  });

  it('can be cancelled before it fires', () => {
    store.setPlaying(true);
    store.setSleepTimer(30);
    store.clearSleepTimer();
    expect(store.getState().sleepTimer).toBeNull();

    vi.advanceTimersByTime(30 * 60 * 1000);
    // Still playing — the timer was cancelled.
    expect(store.getState().isPlaying).toBe(true);
  });

  it('replaces an existing timer when set again', () => {
    store.setSleepTimer(15);
    const first = store.getState().sleepTimer;
    store.setSleepTimer(60);
    expect(store.getState().sleepTimer).not.toBe(first);
    expect(store.getState().sleepTimer.endsAt).toBeGreaterThan(first.endsAt);
  });

  it('treats a falsy duration as "no timer"', () => {
    store.setSleepTimer(15);
    store.setSleepTimer(0); // clears without scheduling a new one
    expect(store.getState().sleepTimer).toBeNull();
  });
});

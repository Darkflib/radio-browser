/**
 * Application state store.
 * Simple reactive store using listeners.
 */

const FAV_KEY = 'radio_browser_favorites';

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch { return new Set(); }
}

function saveFavorites(set) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
}

const state = {
  allStations: [],       // all healthy stations from API
  filtered: [],          // stations after current filters
  filterCountry: '',
  filterGenre: '',
  filterCodec: '',
  searchQuery: '',
  showFavoritesOnly: false,
  nearMe: false,         // sort/annotate by distance from userLocation
  userLocation: null,    // { lat, lng } once geolocation resolves
  currentStation: null,
  isPlaying: false,
  favorites: loadFavorites(),
  sleepTimer: null,      // { timerId, endsAt }
};

const listeners = new Set();

export function getState() { return state; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(changed) {
  listeners.forEach(fn => fn(changed));
}

export function setStations(stations) {
  state.allStations = stations;
  applyFilters();
}

export function setFilterCountry(value) {
  state.filterCountry = value;
  applyFilters();
}

export function setFilterGenre(value) {
  state.filterGenre = value;
  applyFilters();
}

export function setFilterCodec(value) {
  state.filterCodec = value;
  applyFilters();
}

export function setShowFavoritesOnly(value) {
  state.showFavoritesOnly = value;
  applyFilters();
}

export function setNearMe(value) {
  state.nearMe = value;
  applyFilters();
}

export function setUserLocation(loc) {
  state.userLocation = loc;
  applyFilters();
}

// ─── Distance helpers ──────────────────────────────────────────────────────
// Great-circle distance between two lat/lng points, in kilometres (haversine).
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Does a station match the given codec filter? Stations advertise codecs like
// "MP3", "AAC+", or occasionally compound values ("MP3,AAC+"); match on any
// component so a compound stream still shows under either codec.
function matchesCodec(station, codec) {
  if (!codec) return true;
  return station.codec.split(',').some(c => c.trim().toUpperCase() === codec);
}

export function applyFilters() {
  let list = state.allStations;

  if (state.filterCountry) {
    list = list.filter(s => s.countrycode === state.filterCountry || s.country === state.filterCountry);
  }

  if (state.filterGenre) {
    const g = state.filterGenre.toLowerCase();
    list = list.filter(s => s.tags.toLowerCase().split(',').some(t => t.trim() === g));
  }

  if (state.filterCodec) {
    list = list.filter(s => matchesCodec(s, state.filterCodec));
  }

  if (state.showFavoritesOnly) {
    list = list.filter(s => state.favorites.has(s.uuid));
  }

  // "Near me": annotate each station with its distance from the user and sort
  // closest-first. When disabled, clear any stale distance annotations.
  if (state.nearMe && state.userLocation) {
    const { lat, lng } = state.userLocation;
    list = list
      .map(s => {
        s.distanceKm = haversineKm(lat, lng, s.lat, s.lng);
        return s;
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
  } else {
    for (const s of list) s.distanceKm = null;
  }

  state.filtered = list;
  notify({ type: 'filters' });
}

export function setCurrentStation(station) {
  state.currentStation = station;
  notify({ type: 'station' });
}

export function setPlaying(playing) {
  state.isPlaying = playing;
  notify({ type: 'playing' });
}

export function toggleFavorite(uuid) {
  if (state.favorites.has(uuid)) {
    state.favorites.delete(uuid);
  } else {
    state.favorites.add(uuid);
  }
  saveFavorites(state.favorites);
  notify({ type: 'favorites' });
}

export function isFavorite(uuid) {
  return state.favorites.has(uuid);
}

export function setSleepTimer(minutes) {
  clearSleepTimer();
  if (!minutes) return;
  const endsAt = Date.now() + minutes * 60 * 1000;
  const timerId = setTimeout(() => {
    setPlaying(false);
    notify({ type: 'sleep' });
    state.sleepTimer = null;
    notify({ type: 'sleepTimer' });
  }, minutes * 60 * 1000);
  state.sleepTimer = { timerId, endsAt };
  notify({ type: 'sleepTimer' });
}

export function clearSleepTimer() {
  if (state.sleepTimer) {
    clearTimeout(state.sleepTimer.timerId);
    state.sleepTimer = null;
    notify({ type: 'sleepTimer' });
  }
}

// Shared cross-filter helpers so each option list reflects the *other* active
// filters (but not its own), keeping the option counts meaningful.
function byCountry(s) {
  return s.countrycode === state.filterCountry || s.country === state.filterCountry;
}
function byGenre(s) {
  const g = state.filterGenre.toLowerCase();
  return s.tags.toLowerCase().split(',').some(t => t.trim() === g);
}
function byFavorites(s) {
  return state.favorites.has(s.uuid);
}

/**
 * Compute country options with counts, cross-filtered by genre/codec/favorites.
 */
export function getCountryOptions() {
  let list = state.allStations;
  if (state.filterGenre) list = list.filter(byGenre);
  if (state.filterCodec) list = list.filter(s => matchesCodec(s, state.filterCodec));
  if (state.showFavoritesOnly) list = list.filter(byFavorites);
  const map = new Map();
  for (const s of list) {
    if (!s.countrycode) continue;
    const key = s.countrycode;
    const label = s.country || s.countrycode;
    if (!map.has(key)) map.set(key, { code: key, label, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Compute genre options with counts, cross-filtered by country/codec/favorites.
 */
export function getGenreOptions() {
  let list = state.allStations;
  if (state.filterCountry) list = list.filter(byCountry);
  if (state.filterCodec) list = list.filter(s => matchesCodec(s, state.filterCodec));
  if (state.showFavoritesOnly) list = list.filter(byFavorites);
  const map = new Map();
  for (const s of list) {
    for (const raw of s.tags.split(',')) {
      const t = raw.trim().toLowerCase();
      if (!t || t.length > 40) continue;
      map.set(t, (map.get(t) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 200);
}

/**
 * Compute codec options with counts, cross-filtered by country/genre/favorites.
 * Compound codecs ("MP3,AAC+") count under each of their components.
 */
export function getCodecOptions() {
  let list = state.allStations;
  if (state.filterCountry) list = list.filter(byCountry);
  if (state.filterGenre) list = list.filter(byGenre);
  if (state.showFavoritesOnly) list = list.filter(byFavorites);
  const map = new Map();
  for (const s of list) {
    for (const raw of s.codec.split(',')) {
      const c = raw.trim().toUpperCase();
      if (!c) continue;
      map.set(c, (map.get(c) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([codec, count]) => ({ codec, count }))
    .sort((a, b) => b.count - a.count || a.codec.localeCompare(b.codec));
}

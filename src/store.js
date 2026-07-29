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
  searchQuery: '',
  showFavoritesOnly: false,
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

export function setShowFavoritesOnly(value) {
  state.showFavoritesOnly = value;
  applyFilters();
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

  if (state.showFavoritesOnly) {
    list = list.filter(s => state.favorites.has(s.uuid));
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

/**
 * Compute country options with counts based on current genre filter.
 */
export function getCountryOptions() {
  let list = state.allStations;
  if (state.filterGenre) {
    const g = state.filterGenre.toLowerCase();
    list = list.filter(s => s.tags.toLowerCase().split(',').some(t => t.trim() === g));
  }
  if (state.showFavoritesOnly) {
    list = list.filter(s => state.favorites.has(s.uuid));
  }
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
 * Compute genre options with counts based on current country filter.
 */
export function getGenreOptions() {
  let list = state.allStations;
  if (state.filterCountry) {
    list = list.filter(s => s.countrycode === state.filterCountry || s.country === state.filterCountry);
  }
  if (state.showFavoritesOnly) {
    list = list.filter(s => state.favorites.has(s.uuid));
  }
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

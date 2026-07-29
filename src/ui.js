/**
 * UI module — station list, filters, player, search modal, sleep timer.
 */

import {
  getState,
  subscribe,
  setFilterCountry,
  setFilterGenre,
  setShowFavoritesOnly,
  setCurrentStation,
  setPlaying,
  toggleFavorite,
  isFavorite,
  setSleepTimer,
  clearSleepTimer,
  getCountryOptions,
  getGenreOptions,
} from './store.js';

import { flyToStation, refreshMarkerColors } from './globe.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const stationList    = document.getElementById('station-list');
const listEmpty      = document.getElementById('list-empty');
const stationCount   = document.getElementById('station-count');
const filterCountry  = document.getElementById('filter-country');
const filterGenre    = document.getElementById('filter-genre');
const clearFiltersBtn = document.getElementById('clear-filters');
const favToggle      = document.getElementById('favorites-toggle');

const player         = document.getElementById('player');
const playerImg      = document.getElementById('player-img');
const playerName     = document.getElementById('player-name');
const playerCountry  = document.getElementById('player-country');
const playPauseBtn   = document.getElementById('play-pause-btn');
const playIcon       = document.getElementById('play-icon');
const pauseIcon      = document.getElementById('pause-icon');
const volumeSlider   = document.getElementById('volume-slider');
const sleepTimerBtn  = document.getElementById('sleep-timer-btn');
const sleepLabel     = document.getElementById('sleep-label');
const favBtn         = document.getElementById('fav-btn');
const favIcon        = document.getElementById('fav-icon');
const closePlayerBtn = document.getElementById('close-player-btn');
const audioEl        = document.getElementById('audio-el');

const searchBtn      = document.getElementById('search-btn');
const searchModal    = document.getElementById('search-modal');
const searchInput    = document.getElementById('search-input');
const searchResults  = document.getElementById('search-results');

const sleepModal     = document.getElementById('sleep-modal');
const sleepOpts      = document.querySelectorAll('.sleep-opt');
const cancelSleep    = document.getElementById('cancel-sleep');

// ─── Render station card ─────────────────────────────────────────────────────
function renderFaviconImg(src, fallback = '📻') {
  if (src) {
    return `<img src="${escHtml(src)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <span class="card-favicon-fallback" style="display:none">${fallback}</span>`;
  }
  return `<span class="card-favicon-fallback">${fallback}</span>`;
}

function createStationCard(station) {
  const card = document.createElement('div');
  card.className = 'station-card';
  card.dataset.uuid = station.uuid;

  const fav = isFavorite(station.uuid);
  const metaParts = [station.country, station.tags.split(',')[0]?.trim()].filter(Boolean);

  card.innerHTML = `
    <div class="card-favicon">
      ${renderFaviconImg(station.favicon)}
    </div>
    <div class="card-info">
      <div class="card-name">${escHtml(station.name)}</div>
      <div class="card-meta">${escHtml(metaParts.join(' · '))}</div>
    </div>
    <div class="card-right">
      <span class="card-codec">${escHtml(station.codec)}</span>
      <button class="card-fav-btn${fav ? ' active' : ''}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}" data-uuid="${escHtml(station.uuid)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>
  `;

  card.addEventListener('click', e => {
    if (e.target.closest('.card-fav-btn')) return;
    playStation(station);
  });

  card.querySelector('.card-fav-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleFavorite(station.uuid);
  });

  return card;
}

// Keep a rendered card map so we can update without full re-render
const cardMap = new Map();

export function renderStationList(stations) {
  const state = getState();
  stationCount.textContent = `${stations.length} station${stations.length !== 1 ? 's' : ''}`;

  // Remove cards not in new list (Set lookup keeps this O(n), not O(n²))
  const nextUuids = new Set(stations.map(s => s.uuid));
  for (const [uuid, card] of cardMap) {
    if (!nextUuids.has(uuid)) {
      card.remove();
      cardMap.delete(uuid);
    }
  }

  // Add/update cards
  const fragment = document.createDocumentFragment();
  for (const station of stations) {
    if (cardMap.has(station.uuid)) {
      const card = cardMap.get(station.uuid);
      // Update playing state
      card.classList.toggle('playing', state.currentStation?.uuid === station.uuid && state.isPlaying);
      fragment.appendChild(card);
    } else {
      const card = createStationCard(station);
      card.classList.toggle('playing', state.currentStation?.uuid === station.uuid && state.isPlaying);
      cardMap.set(station.uuid, card);
      fragment.appendChild(card);
    }
  }

  stationList.innerHTML = '';
  stationList.appendChild(fragment);

  listEmpty.style.display = stations.length === 0 ? 'block' : 'none';
}

// ─── Filters ─────────────────────────────────────────────────────────────────
export function renderFilterOptions() {
  const state = getState();
  const countries = getCountryOptions();
  const genres = getGenreOptions();

  const prevCountry = filterCountry.value;
  const prevGenre = filterGenre.value;

  // Country select
  filterCountry.innerHTML = '<option value="">All countries</option>';
  for (const { code, label, count } of countries) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${label} (${count})`;
    if (code === prevCountry) opt.selected = true;
    filterCountry.appendChild(opt);
  }

  // Genre select
  filterGenre.innerHTML = '<option value="">All genres</option>';
  for (const { tag, count } of genres) {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = `${capitalize(tag)} (${count})`;
    if (tag === prevGenre) opt.selected = true;
    filterGenre.appendChild(opt);
  }

  const hasFilter = state.filterCountry || state.filterGenre || state.showFavoritesOnly;
  clearFiltersBtn.style.display = hasFilter ? 'block' : 'none';
}

filterCountry.addEventListener('change', () => setFilterCountry(filterCountry.value));
filterGenre.addEventListener('change', () => setFilterGenre(filterGenre.value));

clearFiltersBtn.addEventListener('click', () => {
  filterCountry.value = '';
  filterGenre.value = '';
  setFilterCountry('');
  setFilterGenre('');
  setShowFavoritesOnly(false);
  favToggle.classList.remove('active');
});

favToggle.addEventListener('click', () => {
  const next = !getState().showFavoritesOnly;
  setShowFavoritesOnly(next);
  favToggle.classList.toggle('active', next);
});

// ─── Playback ─────────────────────────────────────────────────────────────────
export function playStation(station) {
  const state = getState();

  if (state.currentStation?.uuid === station.uuid) {
    // Toggle pause/play
    if (state.isPlaying) {
      audioEl.pause();
      setPlaying(false);
    } else {
      audioEl.play().catch(() => {});
      setPlaying(true);
    }
    return;
  }

  // Load new station
  setCurrentStation(station);
  audioEl.src = station.url;
  audioEl.volume = parseFloat(volumeSlider.value);
  audioEl.play().catch(() => {});
  setPlaying(true);

  // Fly globe camera
  flyToStation(station);
}

export function updatePlayerUI() {
  const state = getState();
  const station = state.currentStation;

  if (!station) {
    player.classList.add('hidden');
    return;
  }

  player.classList.remove('hidden');
  playerName.textContent = station.name;
  playerCountry.textContent = [station.country, station.codec + (station.bitrate ? ` ${station.bitrate}k` : '')].filter(Boolean).join(' · ');

  if (station.favicon) {
    playerImg.src = station.favicon;
    playerImg.style.display = '';
    playerImg.onerror = () => { playerImg.style.display = 'none'; };
  } else {
    playerImg.src = '';
    playerImg.style.display = 'none';
  }

  const playing = state.isPlaying;
  playIcon.style.display = playing ? 'none' : '';
  pauseIcon.style.display = playing ? '' : 'none';

  // Update fav button
  const fav = isFavorite(station.uuid);
  favIcon.setAttribute('fill', fav ? '#ef4444' : 'none');
  favIcon.setAttribute('stroke', fav ? '#ef4444' : 'currentColor');

  // Update playing card
  document.querySelectorAll('.station-card').forEach(c => {
    const isPlaying = c.dataset.uuid === station.uuid && state.isPlaying;
    c.classList.toggle('playing', isPlaying);
  });

  // Refresh globe colors
  refreshMarkerColors(state.isPlaying ? station.uuid : null);
}

playPauseBtn.addEventListener('click', () => {
  const state = getState();
  if (!state.currentStation) return;
  if (state.isPlaying) {
    audioEl.pause();
    setPlaying(false);
  } else {
    audioEl.play().catch(() => {});
    setPlaying(true);
  }
});

volumeSlider.addEventListener('input', () => {
  audioEl.volume = parseFloat(volumeSlider.value);
});

audioEl.addEventListener('play', () => setPlaying(true));
audioEl.addEventListener('pause', () => setPlaying(false));
audioEl.addEventListener('error', () => setPlaying(false));

closePlayerBtn.addEventListener('click', () => {
  audioEl.pause();
  audioEl.src = '';
  setCurrentStation(null);
  setPlaying(false);
  player.classList.add('hidden');
  refreshMarkerColors(null);
});

favBtn.addEventListener('click', () => {
  const state = getState();
  if (state.currentStation) toggleFavorite(state.currentStation.uuid);
});

// ─── Search modal ─────────────────────────────────────────────────────────────
function openSearch() {
  searchModal.classList.remove('hidden');
  searchInput.focus();
  renderSearchResults('');
}
function closeSearch() {
  searchModal.classList.add('hidden');
  searchInput.value = '';
  searchResults.innerHTML = '';
}

searchBtn.addEventListener('click', openSearch);
searchModal.addEventListener('click', e => { if (e.target === searchModal) closeSearch(); });

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchModal.classList.contains('hidden') ? openSearch() : closeSearch();
  }
  if (e.key === 'Escape') {
    if (!searchModal.classList.contains('hidden')) { closeSearch(); return; }
    if (!sleepModal.classList.contains('hidden')) { sleepModal.classList.add('hidden'); return; }
  }
});

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => renderSearchResults(searchInput.value), 120);
});

// Keyboard navigation within the search results (↑/↓ to move, Enter to play).
let searchFocusIndex = -1;
function setSearchFocus(index) {
  const items = [...searchResults.querySelectorAll('.search-result-item')];
  if (items.length === 0) { searchFocusIndex = -1; return; }
  searchFocusIndex = (index + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('focused', i === searchFocusIndex));
  items[searchFocusIndex].scrollIntoView({ block: 'nearest' });
}

searchInput.addEventListener('keydown', e => {
  const items = [...searchResults.querySelectorAll('.search-result-item')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setSearchFocus(searchFocusIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setSearchFocus(searchFocusIndex - 1);
  } else if (e.key === 'Enter') {
    const target = items[searchFocusIndex] || items[0];
    if (target) target.click();
  }
});

function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  searchResults.innerHTML = '';
  searchFocusIndex = -1;

  if (!q) return;

  const stations = getState().allStations;
  const results = stations
    .filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.country.toLowerCase().includes(q) ||
      s.tags.toLowerCase().includes(q)
    )
    .slice(0, 50);

  if (results.length === 0) {
    searchResults.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-3);font-size:13px">No results found.</p>';
    return;
  }

  for (const station of results) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    const metaParts = [station.country, station.tags.split(',')[0]?.trim()].filter(Boolean);
    item.innerHTML = `
      <div class="sr-favicon">
        ${station.favicon
          ? `<img src="${escHtml(station.favicon)}" alt="" loading="lazy" onerror="this.parentElement.textContent='📻'">`
          : '📻'}
      </div>
      <div>
        <div class="sr-name">${escHtml(station.name)}</div>
        <div class="sr-meta">${escHtml(metaParts.join(' · '))}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      playStation(station);
      closeSearch();
      scrollToCard(station.uuid);
    });
    searchResults.appendChild(item);
  }
}

// ─── Sleep timer ──────────────────────────────────────────────────────────────
sleepTimerBtn.addEventListener('click', () => {
  sleepModal.classList.remove('hidden');
});
sleepModal.addEventListener('click', e => { if (e.target === sleepModal) sleepModal.classList.add('hidden'); });

sleepOpts.forEach(btn => {
  btn.addEventListener('click', () => {
    const mins = parseInt(btn.dataset.mins, 10);
    setSleepTimer(mins);
    sleepOpts.forEach(b => b.classList.toggle('active', b === btn));
    sleepModal.classList.add('hidden');
    updateSleepLabel();
  });
});

cancelSleep.addEventListener('click', () => {
  clearSleepTimer();
  sleepOpts.forEach(b => b.classList.remove('active'));
  sleepModal.classList.add('hidden');
  updateSleepLabel();
});

function updateSleepLabel() {
  const state = getState();
  if (state.sleepTimer) {
    const mins = Math.ceil((state.sleepTimer.endsAt - Date.now()) / 60000);
    sleepLabel.textContent = `${mins}m`;
  } else {
    sleepLabel.textContent = 'Sleep';
  }
}

// Tick the sleep label every 30s
setInterval(updateSleepLabel, 30000);

// ─── Scroll to card ───────────────────────────────────────────────────────────
export function scrollToCard(uuid) {
  const card = stationList.querySelector(`[data-uuid="${uuid}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.add('highlight-scroll');
  setTimeout(() => card.classList.remove('highlight-scroll'), 700);
}

// ─── Subscribe to state changes ───────────────────────────────────────────────
subscribe(({ type }) => {
  const state = getState();
  if (type === 'filters') {
    renderStationList(state.filtered);
    renderFilterOptions();
    updatePlayerUI();
  }
  if (type === 'station' || type === 'playing') {
    updatePlayerUI();
  }
  if (type === 'favorites') {
    updatePlayerUI();
    // Refresh fav buttons in list
    document.querySelectorAll('.card-fav-btn').forEach(btn => {
      const uuid = btn.dataset.uuid;
      const fav = isFavorite(uuid);
      btn.classList.toggle('active', fav);
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', fav ? 'currentColor' : 'none');
      btn.title = fav ? 'Remove from favorites' : 'Add to favorites';
    });
    if (state.showFavoritesOnly) renderStationList(state.filtered);
  }
  if (type === 'sleepTimer') {
    updateSleepLabel();
  }
  if (type === 'sleep') {
    // Sleep timer fired — audio already paused by store
    audioEl.pause();
  }
});

// ─── Globe click → play + scroll ─────────────────────────────────────────────
export function onGlobeStationClick(uuid) {
  const state = getState();
  // Try to find in filtered list first, then all stations
  const station =
    state.filtered.find(s => s.uuid === uuid) ||
    state.allStations.find(s => s.uuid === uuid);
  if (!station) return;
  playStation(station);
  scrollToCard(uuid);
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
export function showSkeletons(count = 12) {
  stationList.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-lines">
        <div class="skeleton skeleton-line-a"></div>
        <div class="skeleton skeleton-line-b"></div>
      </div>
    </div>
  `).join('');
  stationCount.textContent = 'Loading…';
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

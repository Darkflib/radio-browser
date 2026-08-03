import './style.css';
import { fetchStations, fetchStationByUuid } from './api.js';
import { setStations, addStationToTop, getState, subscribe } from './store.js';
import { initGlobe, updateGlobeMarkers } from './globe.js';
import {
  renderStationList,
  renderFilterOptions,
  showSkeletons,
  onGlobeStationClick,
  onGlobeClusterClick,
  openStationByUuid,
} from './ui.js';

const stationCount = document.getElementById('station-count');
const globeContainer = document.getElementById('globe-container');

async function main() {
  // Show loading state
  showSkeletons(14);

  // Initialise globe
  initGlobe(globeContainer, onGlobeStationClick, onGlobeClusterClick);

  // Subscribe to state changes to keep globe in sync
  subscribe(({ type }) => {
    if (type === 'filters') {
      const { filtered } = getState();
      updateGlobeMarkers(filtered);
    }
  });

  // Fetch stations
  try {
    stationCount.textContent = 'Fetching stations…';
    const stations = await fetchStations(msg => {
      stationCount.textContent = msg;
    });

    setStations(stations);

    const { filtered } = getState();
    renderStationList(filtered);
    renderFilterOptions();
    updateGlobeMarkers(filtered);

    // Deep-link: ?station=<uuid> selects and plays that station on load.
    await handleDeepLink();
  } catch (err) {
    console.error('Failed to load stations:', err);
    stationCount.textContent = 'Failed to load';
    document.getElementById('list-empty').style.display = 'block';
    document.getElementById('list-empty').textContent =
      'Could not load stations. Please check your connection and refresh.';
  }
}

/**
 * If the page was opened with ?station=<uuid>, select and play that station.
 * Falls back to fetching the station by UUID when it isn't in the cached set.
 */
async function handleDeepLink() {
  const uuid = new URLSearchParams(window.location.search).get('station');
  if (!uuid) return;

  if (openStationByUuid(uuid)) return;

  // Not in the loaded set — try resolving it directly, then inject and open.
  const station = await fetchStationByUuid(uuid);
  if (!station) return;
  addStationToTop(station);
  const { filtered } = getState();
  renderStationList(filtered);
  renderFilterOptions();
  updateGlobeMarkers(filtered);
  openStationByUuid(uuid);
}

main();

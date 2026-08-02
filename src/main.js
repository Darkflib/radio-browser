import './style.css';
import { fetchStations } from './api.js';
import { setStations, getState, subscribe } from './store.js';
import { initGlobe, updateGlobeMarkers } from './globe.js';
import {
  renderStationList,
  renderFilterOptions,
  showSkeletons,
  onGlobeStationClick,
  onGlobeClusterClick,
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
  } catch (err) {
    console.error('Failed to load stations:', err);
    stationCount.textContent = 'Failed to load';
    document.getElementById('list-empty').style.display = 'block';
    document.getElementById('list-empty').textContent =
      'Could not load stations. Please check your connection and refresh.';
  }
}

main();

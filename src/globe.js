/**
 * Globe module — wraps globe.gl
 *
 * Renders a minimalist white "vector" globe (Linear/Vercel aesthetic):
 *  - solid light-grey sphere (no satellite texture)
 *  - country landmasses drawn as accurate filled vector polygons
 *  - stations shown as simple colored dots
 *
 * Country geometry is bundled (world-atlas) so the base map works offline;
 * only station data is fetched at runtime.
 *
 * Markers are cached by stationuuid so dots survive filter toggles.
 */

import Globe from 'globe.gl';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import { getState } from './store.js';
import { layoutStations } from './cluster.js';

let globeInstance = null;

// UUID → marker object cache so dots aren't recreated on filter changes
const markerCache = new Map();

let onStationClick = null;
let onClusterClick = null;
let currentPlayingUuid = null;

const COLORS = {
  default: '#2563eb', // blue
  playing: '#ef4444', // red
  favorite: '#f59e0b', // amber
};

// Read a themed colour from the CSS custom properties so the globe stays in
// sync with the active light/dark theme.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function themeColors() {
  return {
    ocean: cssVar('--globe-ocean', '#d6e4f2'),
    land: cssVar('--globe-land', 'rgba(148,163,184,0.22)'),
    stroke: cssVar('--globe-stroke', 'rgba(71,85,105,0.55)'),
    atmosphere: cssVar('--globe-atmosphere', '#bfd3f2'),
  };
}

// Country polygons (GeoJSON features) derived from bundled topojson.
const COUNTRIES = feature(worldData, worldData.objects.countries).features;

function getMarkerColor(uuid) {
  const state = getState();
  if (uuid === currentPlayingUuid) return COLORS.playing;
  if (state.favorites.has(uuid)) return COLORS.favorite;
  return COLORS.default;
}

// A cluster takes on the "strongest" state of its members: playing > favorite.
function clusterColor(stations) {
  const state = getState();
  if (stations.some(s => s.uuid === currentPlayingUuid)) return COLORS.playing;
  if (stations.some(s => state.favorites.has(s.uuid))) return COLORS.favorite;
  return COLORS.default;
}

/**
 * Build or retrieve a station marker, positioned at the given display coords
 * (which may be offset from the true location when fanned out of a stack).
 */
function stationMarker(station, lat, lng) {
  let m = markerCache.get(station.uuid);
  if (!m) {
    m = { type: 'station', uuid: station.uuid };
    markerCache.set(station.uuid, m);
  }
  m.lat = lat;
  m.lng = lng;
  m.name = station.name;
  m.country = station.country;
  m.codec = station.codec;
  m.bitrate = station.bitrate;
  m.color = getMarkerColor(station.uuid);
  m.size = 0.28;
  return m;
}

/**
 * Build a cluster marker for a dense stack of co-located stations. Sized up a
 * little with the count; clicking it opens a picker listing every member.
 */
function clusterMarker(stations, lat, lng) {
  return {
    type: 'cluster',
    lat,
    lng,
    count: stations.length,
    stations,
    country: stations[0]?.country || '',
    color: clusterColor(stations),
    size: Math.min(0.62, 0.32 + stations.length * 0.012),
  };
}

/**
 * Turn the filtered station list into globe points: singletons as-is, small
 * co-located groups fanned into a rosette, dense groups as one cluster marker.
 */
function buildPoints(stations) {
  return layoutStations(stations).map(node =>
    node.kind === 'cluster'
      ? clusterMarker(node.stations, node.lat, node.lng)
      : stationMarker(node.station, node.lat, node.lng)
  );
}

/**
 * Initialise the globe in the given DOM element.
 */
export function initGlobe(container, onClickCb, onClusterClickCb) {
  onStationClick = onClickCb;
  onClusterClick = onClusterClickCb;

  globeInstance = Globe()(container);

  const theme = themeColors();

  globeInstance
    // No texture — a clean solid sphere fits the minimalist theme.
    .globeImageUrl(null)
    .backgroundColor('rgba(0,0,0,0)')
    .showGlobe(true)
    .showGraticules(false)
    .showAtmosphere(true)
    .atmosphereColor(theme.atmosphere)
    .atmosphereAltitude(0.16)
    // Country landmasses as real filled polygons: accurate borders, subtle
    // slate fill on the sphere. Fast (a few hundred shapes) and crisp,
    // unlike dotted hex-polygons which blur country outlines.
    .polygonsData(COUNTRIES)
    .polygonCapColor(() => themeColors().land)
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => themeColors().stroke)
    .polygonAltitude(0.006)
    // Station dots — kept small and low-poly so hundreds render smoothly.
    // pointsMerge stays false so each dot remains hover/click interactive.
    .pointsData([])
    .pointLat(d => d.lat)
    .pointLng(d => d.lng)
    .pointColor(d => d.color)
    .pointAltitude(0.012)
    .pointRadius(d => d.size)
    .pointResolution(6)
    .pointsMerge(false)
    // Tooltip (names/details shown only on hover — never rendered onto the globe)
    .pointLabel(d => d.type === 'cluster'
      ? `
      <div class="globe-tooltip">
        <strong>${d.count} stations</strong>
        <span>${escHtml(d.country)}${d.country ? ' · ' : ''}click to list</span>
      </div>
    `
      : `
      <div class="globe-tooltip">
        <strong>${escHtml(d.name)}</strong>
        <span>${escHtml(d.country)}${d.codec ? ' · ' + escHtml(d.codec) : ''}${d.bitrate ? ' · ' + d.bitrate + ' kbps' : ''}</span>
      </div>
    `)
    .onPointClick(d => {
      if (d.type === 'cluster') {
        onClusterClick?.(d.stations);
      } else {
        onStationClick?.(d.uuid);
      }
    })
    // "You are here" ring at the user's geolocation (populated on demand).
    .ringsData([])
    .ringLat(d => d.lat)
    .ringLng(d => d.lng)
    .ringColor(() => t => `rgba(37,99,235,${1 - t})`)
    .ringMaxRadius(4)
    .ringPropagationSpeed(1.4)
    .ringRepeatPeriod(900);

  // Softly-tinted ocean sphere — reads distinctly from land without breaking
  // the clean, minimalist look. Colour follows the active theme.
  const mat = globeInstance.globeMaterial();
  if (mat) {
    mat.color?.set?.(theme.ocean);
    if ('shininess' in mat) mat.shininess = 4;
  }

  // Slow, gentle auto-rotation until the user interacts.
  const controls = globeInstance.controls();
  if (controls) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 180;
    // Stop auto-rotation on first user interaction.
    const stopRotate = () => { controls.autoRotate = false; };
    controls.addEventListener('start', stopRotate);
  }

  // Auto-size to the container.
  const resize = () => {
    globeInstance.width(container.clientWidth);
    globeInstance.height(container.clientHeight);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Start with a pleasant overview.
  globeInstance.pointOfView({ lat: 25, lng: 0, altitude: 2.4 }, 0);

  return globeInstance;
}

/**
 * Update globe markers from the filtered station list. Co-located stations are
 * fanned out or clustered so every station stays selectable. Station markers
 * are cached by uuid so dots survive filter toggles.
 */
export function updateGlobeMarkers(stations) {
  if (!globeInstance) return;
  globeInstance.pointsData(buildPoints(stations));
}

/**
 * Refresh colors for all currently visible points (e.g. after playback change).
 */
export function refreshMarkerColors(playingUuid) {
  if (!globeInstance) return;
  currentPlayingUuid = playingUuid ?? null;
  const current = globeInstance.pointsData();
  current.forEach(m => {
    m.color = m.type === 'cluster' ? clusterColor(m.stations) : getMarkerColor(m.uuid);
  });
  globeInstance.pointsData([...current]);
}

/**
 * Re-apply themed colours to the globe (ocean, land, borders, atmosphere).
 * Called when the user toggles light/dark mode.
 */
export function applyGlobeTheme() {
  if (!globeInstance) return;
  const theme = themeColors();
  const mat = globeInstance.globeMaterial();
  if (mat) mat.color?.set?.(theme.ocean);
  globeInstance.atmosphereColor(theme.atmosphere);
  // Force the polygon colour accessors (which read live CSS vars) to re-run.
  globeInstance
    .polygonCapColor(() => themeColors().land)
    .polygonStrokeColor(() => themeColors().stroke);
}

/**
 * Show (or clear) a pulsing "you are here" ring at the given coordinates.
 * Pass null to remove it.
 */
export function setUserLocationMarker(lat, lng) {
  if (!globeInstance) return;
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    globeInstance.ringsData([]);
    return;
  }
  globeInstance.ringsData([{ lat, lng }]);
}

/**
 * Fly the camera to an arbitrary location.
 */
export function flyTo(lat, lng, altitude = 1.6) {
  if (!globeInstance) return;
  const controls = globeInstance.controls();
  if (controls) controls.autoRotate = false;
  globeInstance.pointOfView({ lat, lng, altitude }, 900);
}

/**
 * Fly the camera to a specific station's location.
 */
export function flyToStation(station) {
  if (!globeInstance || !station) return;
  const controls = globeInstance.controls();
  if (controls) controls.autoRotate = false;
  globeInstance.pointOfView({ lat: station.lat, lng: station.lng, altitude: 1.5 }, 900);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

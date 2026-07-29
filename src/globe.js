/**
 * Globe module — wraps globe.gl
 *
 * Renders a minimalist white "vector" globe (Linear/Vercel aesthetic):
 *  - solid light-grey sphere (no satellite texture)
 *  - country landmasses drawn as subtle dotted hex-polygons
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

let globeInstance = null;

// UUID → marker object cache so dots aren't recreated on filter changes
const markerCache = new Map();

let onStationClick = null;
let currentPlayingUuid = null;

const COLORS = {
  default: '#2563eb', // blue
  playing: '#ef4444', // red
  favorite: '#f59e0b', // amber
};

// Country polygons (GeoJSON features) derived from bundled topojson.
const COUNTRIES = feature(worldData, worldData.objects.countries).features;

function getMarkerColor(uuid) {
  const state = getState();
  if (uuid === currentPlayingUuid) return COLORS.playing;
  if (state.favorites.has(uuid)) return COLORS.favorite;
  return COLORS.default;
}

/**
 * Build or retrieve a marker for a station.
 */
function getMarker(station) {
  if (markerCache.has(station.uuid)) {
    const m = markerCache.get(station.uuid);
    m.color = getMarkerColor(station.uuid);
    return m;
  }
  const m = {
    uuid: station.uuid,
    lat: station.lat,
    lng: station.lng,
    name: station.name,
    country: station.country,
    codec: station.codec,
    bitrate: station.bitrate,
    color: getMarkerColor(station.uuid),
    size: 0.4,
  };
  markerCache.set(station.uuid, m);
  return m;
}

/**
 * Initialise the globe in the given DOM element.
 */
export function initGlobe(container, onClickCb) {
  onStationClick = onClickCb;

  globeInstance = Globe()(container);

  globeInstance
    // No texture — a clean solid sphere fits the white/minimalist theme.
    .globeImageUrl(null)
    .backgroundColor('rgba(0,0,0,0)')
    .showGlobe(true)
    .showGraticules(false)
    .showAtmosphere(true)
    .atmosphereColor('#bfd3f2')
    .atmosphereAltitude(0.16)
    // Country landmasses as subtle dotted hex-polygons (the "vector" look)
    .hexPolygonsData(COUNTRIES)
    .hexPolygonResolution(3)
    .hexPolygonMargin(0.55)
    .hexPolygonUseDots(true)
    .hexPolygonColor(() => 'rgba(113,125,148,0.55)')
    .hexPolygonAltitude(0.005)
    // Station dots
    .pointsData([])
    .pointLat(d => d.lat)
    .pointLng(d => d.lng)
    .pointColor(d => d.color)
    .pointAltitude(0.01)
    .pointRadius(d => d.size)
    .pointResolution(8)
    .pointsMerge(false)
    // Tooltip (names/details shown only on hover — never rendered onto the globe)
    .pointLabel(d => `
      <div class="globe-tooltip">
        <strong>${escHtml(d.name)}</strong>
        <span>${escHtml(d.country)}${d.codec ? ' · ' + escHtml(d.codec) : ''}${d.bitrate ? ' · ' + d.bitrate + ' kbps' : ''}</span>
      </div>
    `)
    .onPointClick(d => {
      onStationClick?.(d.uuid);
    });

  // Light-grey sphere material for the minimalist look.
  const mat = globeInstance.globeMaterial();
  if (mat) {
    mat.color?.set?.('#eef1f6');
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
 * Update globe markers from the filtered station list.
 * Uses cached markers so dots don't disappear on filter toggle.
 */
export function updateGlobeMarkers(stations) {
  if (!globeInstance) return;
  const markers = stations.map(s => {
    const m = getMarker(s);
    m.color = getMarkerColor(s.uuid);
    return m;
  });
  globeInstance.pointsData(markers);
}

/**
 * Refresh colors for all currently visible points (e.g. after playback change).
 */
export function refreshMarkerColors(playingUuid) {
  if (!globeInstance) return;
  currentPlayingUuid = playingUuid ?? null;
  const current = globeInstance.pointsData();
  current.forEach(m => { m.color = getMarkerColor(m.uuid); });
  globeInstance.pointsData([...current]);
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

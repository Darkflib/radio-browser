/**
 * Globe module — wraps globe.gl
 * Manages a 3D globe with station dots, hover tooltips, and click callbacks.
 * Markers are cached by stationuuid so they survive filter toggles.
 */

import Globe from 'globe.gl';
import { getState } from './store.js';

let globeInstance = null;

// UUID → marker object cache so dots aren't recreated on filter changes
const markerCache = new Map();

let onStationClick = null;
let currentPlayingUuid = null;

const COLORS = {
  default: 'rgba(37,99,235,0.85)',
  playing: '#ef4444',
  favorite: '#f59e0b',
};

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
    size: 0.45,
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
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-day.jpg')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#e0e7ff')
    .atmosphereAltitude(0.12)
    // Points layer
    .pointsData([])
    .pointLat(d => d.lat)
    .pointLng(d => d.lng)
    .pointColor(d => d.color)
    .pointAltitude(0)
    .pointRadius(d => d.size)
    .pointResolution(6)
    // Labels (disabled — names shown only in tooltips)
    .labelTypeFace(null)
    // Tooltip
    .pointLabel(d => `
      <div class="globe-tooltip">
        <strong>${escHtml(d.name)}</strong>
        <span>${escHtml(d.country)}${d.codec ? ' · ' + escHtml(d.codec) : ''}${d.bitrate ? ' · ' + d.bitrate + ' kbps' : ''}</span>
      </div>
    `)
    .onPointClick(d => {
      onStationClick?.(d.uuid);
    });

  // Auto-size
  const ro = new ResizeObserver(() => {
    globeInstance.width(container.clientWidth);
    globeInstance.height(container.clientHeight);
  });
  ro.observe(container);

  globeInstance.width(container.clientWidth);
  globeInstance.height(container.clientHeight);

  // Start with a nice view
  globeInstance.pointOfView({ lat: 20, lng: 0, altitude: 2.2 }, 0);

  return globeInstance;
}

/**
 * Update globe markers from the filtered station list.
 * Uses cached markers so dots don't disappear on filter toggle.
 */
export function updateGlobeMarkers(stations) {
  if (!globeInstance) return;
  // Refresh color for each visible station
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
  globeInstance.pointOfView({ lat: station.lat, lng: station.lng, altitude: 1.4 }, 800);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

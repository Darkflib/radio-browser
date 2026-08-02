/**
 * Co-location layout for globe markers (pure, dependency-free).
 *
 * Radio-browser stores coordinates at city granularity, so many stations share
 * (near-)identical lat/lng and would stack into a single un-clickable dot. This
 * module groups co-located stations and decides how each group is drawn:
 *  - a lone station stays exactly where it is;
 *  - a small group is fanned out into a sunflower rosette so each dot is
 *    individually selectable;
 *  - a dense group collapses into one cluster node that opens a picker.
 *
 * Keeping this free of globe.gl / DOM imports makes it unit-testable in Node.
 */

// ~2 decimals ≈ 1 km — stations closer than this are treated as the same spot.
export const COORD_PRECISION = 2;
// Groups up to this size fan out; larger ones become a single cluster node.
export const SPREAD_LIMIT = 8;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function coordKey(lat, lng, precision = COORD_PRECISION) {
  return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
}

/**
 * Deterministic sunflower-spiral offset (in degrees) for the i-th co-located
 * station, so a stack becomes a readable rosette centred on its true point.
 */
export function spiralOffset(lat, lng, i) {
  const r = 0.5 * Math.sqrt(i + 0.5);          // degrees from the true point
  const theta = (i + 0.5) * GOLDEN_ANGLE;
  const dLat = r * Math.cos(theta);
  // Keep the rosette visually circular by widening longitude with latitude,
  // clamped so it doesn't blow up near the poles.
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = (r * Math.sin(theta)) / cosLat;
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Group stations by location and produce layout nodes.
 * Returns an array of either:
 *   { kind: 'station', station, lat, lng }   // possibly offset from true coords
 *   { kind: 'cluster', stations, lat, lng }
 */
export function layoutStations(stations, opts = {}) {
  const spreadLimit = opts.spreadLimit ?? SPREAD_LIMIT;
  const precision = opts.precision ?? COORD_PRECISION;

  const groups = new Map();
  for (const s of stations) {
    const key = coordKey(s.lat, s.lng, precision);
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(s);
  }

  const nodes = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const s = group[0];
      nodes.push({ kind: 'station', station: s, lat: s.lat, lng: s.lng });
    } else if (group.length <= spreadLimit) {
      const { lat, lng } = group[0];
      group.forEach((s, i) => {
        const pos = spiralOffset(lat, lng, i);
        nodes.push({ kind: 'station', station: s, lat: pos.lat, lng: pos.lng });
      });
    } else {
      const { lat, lng } = group[0];
      nodes.push({ kind: 'cluster', stations: group, lat, lng });
    }
  }
  return nodes;
}

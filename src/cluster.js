/**
 * Co-location layout for globe markers (pure, dependency-free).
 *
 * Radio-browser stores coordinates at city granularity, so many stations sit at
 * (near-)identical lat/lng and would stack into a single un-clickable dot. This
 * module groups nearby stations and decides how each group is drawn:
 *  - a lone station stays exactly where it is;
 *  - a small group is fanned out into a sunflower rosette so each dot is
 *    individually selectable;
 *  - a dense group collapses into one cluster node that opens a picker.
 *
 * Grouping is by real distance, NOT by rounding coordinates to a grid: a grid
 * splits stations that straddle a cell boundary (two points a few hundred
 * metres apart can round to different cells and never group). Distance-based
 * clustering groups anything within GROUP_RADIUS_KM of a cluster's seed.
 *
 * Keeping this free of globe.gl / DOM imports makes it unit-testable in Node.
 */

// Stations within this distance of a cluster's seed are treated as co-located.
// City coordinates are approximate and cluster tightly, so ~5 km groups nearby
// stations that would otherwise render almost on top of each other; grouped
// stations then fan out (or cluster) so each stays selectable.
export const GROUP_RADIUS_KM = 5;
// Groups up to this size fan out; larger ones become a single cluster node.
export const SPREAD_LIMIT = 8;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Fast planar (equirectangular) distance in km — accurate enough at the couple-
 * of-kilometre scale we group at, and far cheaper than haversine per pair.
 */
export function approxDistanceKm(lat1, lng1, lat2, lng2) {
  const kmPerDeg = 111.32;
  const dLat = (lat2 - lat1) * kmPerDeg;
  // Normalise the longitude delta into [-180, 180) so points either side of the
  // antimeridian measure the short way around the globe, not the long way.
  const dLngDeg = ((lng2 - lng1 + 180) % 360 + 360) % 360 - 180;
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLng = dLngDeg * kmPerDeg * Math.cos(midLat);
  return Math.hypot(dLat, dLng);
}

/**
 * Deterministic sunflower-spiral offset (in degrees) for the i-th co-located
 * station, so a stack becomes a readable rosette centred on the given point.
 */
export function spiralOffset(lat, lng, i) {
  const r = 0.5 * Math.sqrt(i + 0.5);          // degrees from the centre
  const theta = (i + 0.5) * GOLDEN_ANGLE;
  const dLat = r * Math.cos(theta);
  // Keep the rosette visually circular by widening longitude with latitude,
  // clamped so it doesn't blow up near the poles.
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = (r * Math.sin(theta)) / cosLat;
  return { lat: lat + dLat, lng: lng + dLng };
}

function centroid(members) {
  let lat = 0, lng = 0;
  for (const s of members) { lat += s.lat; lng += s.lng; }
  return { lat: lat / members.length, lng: lng / members.length };
}

/**
 * Greedy distance clustering. Each station joins the nearest existing cluster
 * whose seed is within radiusKm; otherwise it seeds a new cluster. Matching
 * against the fixed seed (not a drifting centroid) bounds a cluster's diameter
 * to ~2·radiusKm and avoids runaway chaining across a dense city.
 */
function clusterByDistance(stations, radiusKm) {
  const clusters = [];
  for (const s of stations) {
    let best = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const d = approxDistanceKm(s.lat, s.lng, c.lat, c.lng);
      if (d <= radiusKm && d < bestDist) { best = c; bestDist = d; }
    }
    if (best) {
      best.members.push(s);
    } else {
      clusters.push({ lat: s.lat, lng: s.lng, members: [s] });
    }
  }
  return clusters;
}

/**
 * Group stations by proximity and produce layout nodes.
 * Returns an array of either:
 *   { kind: 'station', station, lat, lng }   // possibly offset from true coords
 *   { kind: 'cluster', stations, lat, lng }
 */
export function layoutStations(stations, opts = {}) {
  const spreadLimit = opts.spreadLimit ?? SPREAD_LIMIT;
  const radiusKm = opts.radiusKm ?? GROUP_RADIUS_KM;

  const clusters = clusterByDistance(stations, radiusKm);

  const nodes = [];
  for (const { members } of clusters) {
    if (members.length === 1) {
      const s = members[0];
      nodes.push({ kind: 'station', station: s, lat: s.lat, lng: s.lng });
    } else if (members.length <= spreadLimit) {
      // Fan out around the group's centre so the rosette sits amongst members.
      const c = centroid(members);
      members.forEach((s, i) => {
        const pos = spiralOffset(c.lat, c.lng, i);
        nodes.push({ kind: 'station', station: s, lat: pos.lat, lng: pos.lng });
      });
    } else {
      const c = centroid(members);
      nodes.push({ kind: 'cluster', stations: members, lat: c.lat, lng: c.lng });
    }
  }
  return nodes;
}

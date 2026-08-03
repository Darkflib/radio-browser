import { describe, it, expect } from 'vitest';
import {
  approxDistanceKm,
  spiralOffset,
  layoutStations,
  GROUP_RADIUS_KM,
  SPREAD_LIMIT,
} from '../../src/cluster.js';
import {
  station,
  coLocatedPair,
  separatePair,
  denseStack,
  antimeridianPair,
} from '../fixtures/stations.js';

describe('approxDistanceKm', () => {
  it('is ~0 for identical points', () => {
    expect(approxDistanceKm(51.5, -0.12, 51.5, -0.12)).toBeCloseTo(0, 5);
  });

  it('measures the short way across the antimeridian', () => {
    // 179.9E to 179.9W is 0.2° apart at the equator (~22km), not ~40,000km.
    const d = approxDistanceKm(0, 179.9, 0, -179.9);
    expect(d).toBeGreaterThan(15);
    expect(d).toBeLessThan(30);
  });

  it('roughly matches 1° of latitude ≈ 111km', () => {
    expect(approxDistanceKm(0, 0, 1, 0)).toBeCloseTo(111.32, 1);
  });

  it('narrows longitude distance with latitude (cos factor)', () => {
    const atEquator = approxDistanceKm(0, 0, 0, 1);
    const atSixty = approxDistanceKm(60, 0, 60, 1);
    // cos(60°) = 0.5, so a degree of longitude is ~half as wide at 60°.
    expect(atSixty).toBeCloseTo(atEquator * 0.5, 0);
  });
});

describe('spiralOffset', () => {
  it('is deterministic for the same inputs', () => {
    expect(spiralOffset(50, 10, 3)).toEqual(spiralOffset(50, 10, 3));
  });

  it('spreads successive indices apart', () => {
    const a = spiralOffset(50, 10, 0);
    const b = spiralOffset(50, 10, 1);
    expect(a).not.toEqual(b);
  });

  it('clamps longitude scaling near the poles (no blow-up)', () => {
    const near = spiralOffset(89.9, 0, 5);
    expect(Number.isFinite(near.lat)).toBe(true);
    expect(Number.isFinite(near.lng)).toBe(true);
  });
});

describe('layoutStations', () => {
  it('leaves a singleton exactly where it is', () => {
    const s = station({ uuid: 'solo', lat: 12.34, lng: 56.78 });
    const nodes = layoutStations([s]);
    expect(nodes).toEqual([
      { kind: 'station', station: s, lat: 12.34, lng: 56.78 },
    ]);
  });

  it('returns an empty layout for no stations', () => {
    expect(layoutStations([])).toEqual([]);
  });

  it('groups points inside the group radius and fans them out', () => {
    const nodes = layoutStations(coLocatedPair);
    // Both remain individual station nodes (small group → fan out, not cluster).
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.kind === 'station')).toBe(true);
    // They are offset off their true coords by the rosette, but every original
    // station is represented exactly once.
    const uuids = nodes.map(n => n.station.uuid).sort();
    expect(uuids).toEqual(['co-a', 'co-b']);
    // Crucially: grouped members are fanned out, so NONE keep their own coords.
    // (Without this, two ungrouped singletons would pass the checks above.)
    expect(nodes.every(n => n.lat !== n.station.lat || n.lng !== n.station.lng)).toBe(true);
  });

  it('keeps points outside the group radius separate and un-offset', () => {
    const nodes = layoutStations(separatePair);
    expect(nodes).toHaveLength(2);
    for (const n of nodes) {
      expect(n.kind).toBe('station');
      // Un-grouped singletons keep their exact coordinates.
      expect(n.lat).toBe(n.station.lat);
      expect(n.lng).toBe(n.station.lng);
    }
  });

  it('collapses a group larger than SPREAD_LIMIT into a single cluster', () => {
    const nodes = layoutStations(denseStack);
    expect(nodes).toHaveLength(1);
    const [node] = nodes;
    expect(node.kind).toBe('cluster');
    expect(node.stations).toHaveLength(denseStack.length);
    // Cluster sits at the centroid of its members.
    const avgLat = denseStack.reduce((a, s) => a + s.lat, 0) / denseStack.length;
    expect(node.lat).toBeCloseTo(avgLat, 6);
  });

  it('fans out a group exactly at the spread limit (boundary)', () => {
    const atLimit = Array.from({ length: SPREAD_LIMIT }, (_, i) =>
      station({ uuid: `lim-${i}`, lat: 20 + i * 0.0005, lng: 30 + i * 0.0005 }),
    );
    const nodes = layoutStations(atLimit);
    // == spreadLimit fans out (members.length <= spreadLimit), does not cluster.
    expect(nodes).toHaveLength(SPREAD_LIMIT);
    expect(nodes.every(n => n.kind === 'station')).toBe(true);
  });

  it('clusters a group one past the spread limit (boundary)', () => {
    const overLimit = Array.from({ length: SPREAD_LIMIT + 1 }, (_, i) =>
      station({ uuid: `over-${i}`, lat: 20 + i * 0.0005, lng: 30 + i * 0.0005 }),
    );
    const nodes = layoutStations(overLimit);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('cluster');
  });

  it('groups points straddling the antimeridian together', () => {
    // ~22km apart the short way → within the 5km radius? No — 22km > 5km, so they
    // stay separate; but crucially the distance is small, not ~40,000km. Prove
    // the grouping uses the short-way distance by shrinking them closer.
    const near = [
      station({ uuid: 'am-a', lat: 0, lng: 179.98 }),
      station({ uuid: 'am-b', lat: 0, lng: -179.99 }), // ~3km apart the short way
    ];
    const nodes = layoutStations(near);
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.kind === 'station')).toBe(true); // grouped & fanned
    // Proof they were grouped via the short-way (~3km) distance, not left as two
    // singletons ~40,000km apart: fanned members no longer sit on their coords.
    expect(nodes.every(n => n.lat !== n.station.lat || n.lng !== n.station.lng)).toBe(true);
  });

  it('does not lose or duplicate stations regardless of input order', () => {
    const input = [...denseStack, ...separatePair, station({ uuid: 'far', lat: -40, lng: 170 })];
    const forward = layoutStations(input);
    const reversed = layoutStations([...input].reverse());

    const collect = nodes => {
      const set = new Set();
      for (const n of nodes) {
        if (n.kind === 'cluster') n.stations.forEach(s => set.add(s.uuid));
        else set.add(n.station.uuid);
      }
      return set;
    };

    const expected = new Set(input.map(s => s.uuid));
    expect(collect(forward)).toEqual(expected);
    expect(collect(reversed)).toEqual(expected);
    // Same total station count preserved (no dupes).
    expect(collect(forward).size).toBe(input.length);
  });

  it('honours custom radius and spreadLimit options', () => {
    // With a tiny radius, the co-located pair no longer groups.
    const nodes = layoutStations(coLocatedPair, { radiusKm: 0.1 });
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.lat === n.station.lat)).toBe(true);

    // With spreadLimit 0, even a 2-member group clusters.
    const clustered = layoutStations(coLocatedPair, { spreadLimit: 0 });
    expect(clustered).toHaveLength(1);
    expect(clustered[0].kind).toBe('cluster');
  });

  it('exposes sane default constants', () => {
    expect(GROUP_RADIUS_KM).toBe(5);
    expect(SPREAD_LIMIT).toBe(8);
  });
});

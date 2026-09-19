/**
 * Geometry for the map, mirroring pipeline/geo.py.
 *
 * The pipeline decides what is true; this module only draws it. Both must agree about
 * what "upwind" means, so the formulas are kept identical rather than approximated.
 */

const EARTH_R_M = 6_371_008.8;
const D = Math.PI / 180;

export type LngLat = [number, number];

/** Point reached from an origin along a bearing. */
export function destination(lat: number, lon: number, bearing: number, distM: number): LngLat {
  const d = distM / EARTH_R_M;
  const p1 = lat * D;
  const b = bearing * D;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    lon * D +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(((l2 / D) + 540) % 360) - 180, p2 / D];
}

/** A closed ring approximating a circle of radius metres. Used for plant footprints. */
export function circleRing(lat: number, lon: number, radiusM: number, steps = 48): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destination(lat, lon, (360 * i) / steps, radiusM));
  }
  return ring;
}

/** A wedge from a point, spanning bearings b0 to b1. Used for the upwind cone and the rose. */
export function wedgeRing(
  lat: number, lon: number, b0: number, b1: number, radiusM: number, steps = 16,
): LngLat[] {
  const end = b1 < b0 ? b1 + 360 : b1;
  const ring: LngLat[] = [[lon, lat]];
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destination(lat, lon, (b0 + ((end - b0) * i) / steps) % 360, radiusM));
  }
  ring.push([lon, lat]);
  return ring;
}

export function polygon(ring: LngLat[], properties: Record<string, unknown> = {}) {
  return {
    type: "Feature" as const,
    properties,
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

export function collection(features: ReturnType<typeof polygon>[]) {
  return { type: "FeatureCollection" as const, features };
}

/** Angular uncertainty of one hour's wind, matching the pipeline's sigma table. */
export function sigmaFor(wsMs: number | null, windSource: string): number {
  if (wsMs !== null && wsMs < 1.5) return 45;
  return windSource === "aqs" ? 15 : 25;
}

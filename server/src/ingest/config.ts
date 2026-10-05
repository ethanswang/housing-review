/**
 * Where imported buildings must be to appear on the site. A record outside the
 * area is counted and skipped, not stored, so widening the area later and
 * re-running brings it in.
 *
 * The default is the walkable area around campus: 1.5 km from the Main Quad
 * covers Campustown, the Green Street corridor and the blocks either side.
 * `--radius-km` overrides the radius for one run.
 */
export type TargetArea = { name: string; latitude: number; longitude: number; radiusKm: number }

export const TARGET_AREA: TargetArea = {
  name: 'UIUC campus',
  latitude: 40.1074,
  longitude: -88.2272,
  radiusKm: 1.5,
}

/** Great-circle distance, accurate to metres at this scale. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLon = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function inArea(record: { latitude: number; longitude: number }, area: TargetArea) {
  return distanceKm(record, area) <= area.radiusKm
}

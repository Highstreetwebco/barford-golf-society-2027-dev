import { coordinates, distanceMetres } from './hole-map.js?v=2027-fullscreen-1';

export const HOLE_GPS_RANGE_METRES = 1000 * .9144;
export const MAX_FIX_AGE = 15000;
export const MAX_GPS_ACCURACY = 20;
const earth = 6371008.8, rad = n => n * Math.PI / 180;

// Distance to the mapped tee–dogleg–green route, not only to its green.
// Local tangent projection is appropriate for these short course segments.
export function distanceToHole(point, hole) {
  point = coordinates(point);
  const route = [hole?.tee, hole?.dogleg, hole?.green].map(coordinates).filter(Boolean);
  if (!point || route.length < 2) return null;
  let nearest = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], scale = Math.cos(rad((a.lat + b.lat) / 2));
    const bx = rad(b.lng - a.lng) * earth * scale, by = rad(b.lat - a.lat) * earth;
    const px = rad(point.lng - a.lng) * earth * scale, py = rad(point.lat - a.lat) * earth;
    const length = bx * bx + by * by;
    const t = length ? Math.max(0, Math.min(1, (px * bx + py * by) / length)) : 0;
    const closest = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
    nearest = Math.min(nearest, distanceMetres(point, closest));
  }
  return nearest;
}

export function holeGpsState(fix, hole, now = Date.now()) {
  if (!fix) return 'unavailable';
  if (!coordinates(fix.point) || typeof fix.accuracy !== 'number' || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || typeof fix.timestamp !== 'number' || !Number.isFinite(fix.timestamp) || fix.timestamp > now + 5000) return 'invalid';
  if (now - fix.timestamp > MAX_FIX_AGE) return 'stale';
  if (fix.accuracy > MAX_GPS_ACCURACY) return 'inaccurate';
  const distance = distanceToHole(fix.point, hole);
  if (distance === null) return 'unavailable';
  return distance <= HOLE_GPS_RANGE_METRES ? 'live' : 'away';
}

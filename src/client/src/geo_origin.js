const EARTH_RADIUS_M = 6378137.0;
export function localToGeo(origin, rosX, rosY, rosZ) {
  const east = -Number(rosY);
  const north = Number(rosX);
  const lat = Number(origin.latitude) + north / EARTH_RADIUS_M * 180 / Math.PI;
  const lon = Number(origin.longitude) + east / (EARTH_RADIUS_M * Math.cos(Number(origin.latitude) * Math.PI / 180)) * 180 / Math.PI;
  return { latitude: lat, longitude: lon, altitude: Number(origin.altitude || 0) + Number(rosZ) + Number(origin.z_offset || 0) };
}
export async function loadGeoOrigin(url = '/config/geo-origin.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error('geo-origin load failed: ' + url);
  return await response.json();
}

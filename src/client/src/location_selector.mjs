export const LOCATION_CATALOG = Object.freeze([
  Object.freeze({
    id: 'shibuya',
    label: '渋谷（5km + 600m詳細）',
    scenarioConfig: '/hakoniwa-geo-viewer/config/viewer-config-shibuya.json',
  }),
  Object.freeze({
    id: 'tokyo-tower',
    label: '東京タワー（5km + 600m詳細）',
    scenarioConfig: '/hakoniwa-geo-viewer/config/viewer-config-tokyo-tower.json',
  }),
]);

function normalizedPath(value, baseHref) {
  return new URL(value, baseHref).pathname;
}

export function getLocationId(viewerConfig, baseHref) {
  const selectedPath = normalizedPath(viewerConfig, baseHref);
  return LOCATION_CATALOG.find(
    (location) => normalizedPath(location.scenarioConfig, baseHref) === selectedPath,
  )?.id ?? '';
}

export function buildLocationUrl(locationId, currentHref) {
  const location = LOCATION_CATALOG.find((entry) => entry.id === locationId);
  if (!location) throw new Error(`[LocationSelector] unknown location: ${locationId}`);
  const url = new URL(currentHref);
  url.searchParams.set('scenarioConfig', location.scenarioConfig);
  return url.toString();
}

export function setupLocationSelector(select, currentHref, navigate) {
  if (!select) return;
  const currentUrl = new URL(currentHref);
  const viewerConfig = currentUrl.searchParams.get('scenarioConfig')
    || LOCATION_CATALOG[0].scenarioConfig;
  select.innerHTML = '';
  for (const location of LOCATION_CATALOG) {
    const option = document.createElement('option');
    option.value = location.id;
    option.textContent = location.label;
    select.appendChild(option);
  }
  select.value = getLocationId(viewerConfig, currentHref) || LOCATION_CATALOG[0].id;
  select.addEventListener('change', () => navigate(buildLocationUrl(select.value, currentHref)));
}

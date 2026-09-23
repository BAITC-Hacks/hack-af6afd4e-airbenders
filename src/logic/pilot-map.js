(function (global) {
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const state = { lens: 'traffic', mode: 'after', result: null, layers: {}, projects: [], facilities: [], corridor: null };
  let map, ready = false;
  function collection(features) { return { type: 'FeatureCollection', features }; }
  function point(coordinates, properties) { return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties }; }
  function data(id, value) { if (ready && map.getSource(id)) map.getSource(id).setData(value); }
  function visible(id, show) { if (ready && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none'); }
  function render() {
    if (!ready) return;
    const { lens, mode, result, layers, projects, facilities, corridor } = state;
    data('traffic', layers.traffic || EMPTY);
    data('access', layers[lens] || EMPTY);
    data('facilities', collection(facilities.filter(f => f.kind === lens).map(f => point(f.coordinates, { title: f.title, planned: false }))));
    data('projects', collection(projects.filter(p => lens === 'traffic' ? p.kind === 'bus-lane' : p.kind === lens).map(p => point(p.location, { title: p.title, planned: true }))));
    data('corridor', corridor ? collection([{ type: 'Feature', geometry: corridor.geometry, properties: {} }]) : EMPTY);
    visible('traffic-lines', lens === 'traffic');
    visible('corridor-lines', lens === 'traffic');
    visible('access-points', ['school', 'clinic', 'park'].includes(lens));
    visible('facility-points', ['school', 'clinic', 'park'].includes(lens));
    visible('project-points', mode !== 'before');
    visible('buildings-3d', lens === 'buildings');
    const trafficColor = mode === 'delta'
      ? ['case', ['==', ['get', 'delta'], null], '#50616a', ['interpolate', ['linear'], ['get', 'delta'], -15, '#f27760', 0, '#c4cdd0', 15, '#a7f27b']]
      : ['case', ['==', ['get', mode], null], '#50616a', ['interpolate', ['linear'], ['get', mode], 0, '#f27760', 20, '#f0b96a', 45, '#a7f27b', 70, '#67d9db']];
    map.setPaintProperty('traffic-lines', 'line-color', trafficColor);
    const field = mode === 'before' ? 'beforeMinutes' : 'afterMinutes';
    map.setPaintProperty('access-points', 'circle-color', mode === 'delta'
      ? ['case', ['get', 'newlyCovered'], '#a7f27b', '#667c88']
      : ['case', ['==', ['get', field], null], '#50616a', ['<=', ['get', field], 15], '#a7f27b', '#f27760']);
    map.setPaintProperty('corridor-lines', 'line-opacity', projects.some(p => p.kind === 'bus-lane') && mode !== 'before' ? .9 : .35);
  }
  function popup(event, text) { new maplibregl.Popup().setLngLat(event.lngLat).setText(text).addTo(map); }
  function init() {
    if (!global.maplibregl) throw new Error('Не загрузилась библиотека карты. Расчёт доступен; проверьте подключение к интернету.');
    map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [71.435, 51.1375], zoom: 12.4, pitch: 35, bearing: -15 });
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.on('error', event => {
      if (!ready) {
        const node = document.querySelector('#map-error');
        node.hidden = false;
        node.textContent = 'Карта недоступна: ' + (event.error?.message || 'ошибка загрузки тайлов') + '. Расчёты доступны справа.';
      }
    });
    map.on('load', () => {
      document.querySelector('#map-error').hidden = true;
      for (const id of ['traffic', 'access', 'facilities', 'projects', 'corridor']) map.addSource(id, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'traffic-lines', type: 'line', source: 'traffic', paint: { 'line-width': 3, 'line-opacity': .9, 'line-color': '#50616a' } });
      map.addLayer({ id: 'corridor-lines', type: 'line', source: 'corridor', paint: { 'line-width': 7, 'line-color': '#bba4ff', 'line-opacity': .5, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'access-points', type: 'circle', source: 'access', paint: { 'circle-radius': 4, 'circle-color': '#a7f27b', 'circle-opacity': .7 } });
      map.addLayer({ id: 'facility-points', type: 'circle', source: 'facilities', paint: { 'circle-radius': 6, 'circle-color': '#67d9db', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#142126' } });
      map.addLayer({ id: 'project-points', type: 'circle', source: 'projects', paint: { 'circle-radius': 9, 'circle-color': '#a7f27b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
      if (map.getSource('openmaptiles')) map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12, paint: { 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-color': '#78908a', 'fill-extrusion-opacity': .8 } });
      for (const id of ['facility-points', 'project-points']) map.on('click', id, event => popup(event, event.features[0].properties.title));
      map.on('click', 'traffic-lines', event => {
        const p = event.features[0].properties;
        popup(event, `${p.name || p.edgeId}: ${p.before ?? 'нет проездов'} → ${p.after ?? 'нет проездов'} км/ч. Δ ${p.delta ?? '—'} км/ч`);
      });
      map.on('click', 'access-points', event => {
        const p = event.features[0].properties;
        popup(event, `Пешком до объекта: ${p.beforeMinutes ?? 'нет пути'} → ${p.afterMinutes ?? 'нет пути'} мин.`);
      });
      ready = true;
      render();
    });
  }
  global.PilotMap = { init, update(patch) { Object.assign(state, patch); render(); }, home() { map?.flyTo({ center: [71.435, 51.1375], zoom: 12.4, pitch: 35, bearing: -15 }); } };
})(window);

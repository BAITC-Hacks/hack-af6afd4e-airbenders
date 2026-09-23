(function (global) {
  const COLORS = {
    districts: '#67d9db', roads: '#f0b96a', parks: '#a7f27b',
    schoolsPlanned: '#67d9db', schoolsCurrent: '#a7f27b',
    healthPlanned: '#bba4ff', healthCurrent: '#ff8bb7', green: '#80d995'
  };
  const LENSES = {
    traffic: ['roads'], roads: ['roads'], transit: [], schools: ['schoolsCurrent', 'schoolsPlanned'],
    health: ['healthCurrent', 'healthPlanned'], green: ['parks', 'green'], districts: ['districts'], base: []
  };

  function makeEmptyCollection() { return { type: 'FeatureCollection', features: [] }; }

  function addLayers(map, id) {
    const sourceId = 'logic-' + id;
    map.addSource(sourceId, { type: 'geojson', data: makeEmptyCollection() });
    const color = COLORS[id] || '#a7f27b';
    map.addLayer({
      id: sourceId + '-fill', source: sourceId, type: 'fill',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'fill-color': color, 'fill-opacity': id === 'districts' ? 0.07 : 0.28 }
    });
    map.addLayer({
      id: sourceId + '-line', source: sourceId, type: 'line',
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]],
      paint: { 'line-color': color, 'line-width': id === 'roads' ? 2.2 : 1.3, 'line-opacity': id === 'districts' ? 0.7 : 0.9 }
    });
    map.addLayer({
      id: sourceId + '-point', source: sourceId, type: 'circle',
      filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
      paint: { 'circle-radius': 5, 'circle-color': color, 'circle-stroke-color': '#0b141b', 'circle-stroke-width': 1.5 }
    });
    for (const layerId of [sourceId + '-fill', sourceId + '-line', sourceId + '-point']) {
      map.setLayoutProperty(layerId, 'visibility', 'none');
    }
  }

  function init(map, sources, data) {
    Object.keys(sources).forEach((id) => addLayers(map, id));
    map.addSource('logic-projects', { type: 'geojson', data: makeEmptyCollection() });
    map.addLayer({
      id: 'logic-project-points', type: 'circle', source: 'logic-projects',
      paint: { 'circle-radius': 7, 'circle-color': '#a7f27b', 'circle-stroke-color': '#102018', 'circle-stroke-width': 2 }
    });
    map.addLayer({
      id: 'logic-project-labels', type: 'symbol', source: 'logic-projects',
      layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, 1.4] },
      paint: { 'text-color': '#f0f6e9', 'text-halo-color': '#10191c', 'text-halo-width': 1.5 }
    });
    map.on('click', 'logic-project-points', (event) => {
      const properties = event.features?.[0]?.properties || {};
      new maplibregl.Popup().setLngLat(event.lngLat)
        .setText((properties.label || 'Проект') + ' · ' + (properties.note || 'условная точка демонстрации'))
        .addTo(map);
    });
    applyData(map, data);
    return { setLens: (lens) => setLens(map, lens), setProjects: (projects) => setProjects(map, projects) };
  }

  function applyData(map, data) {
    for (const [id, entry] of Object.entries(data)) {
      const source = map.getSource('logic-' + id);
      if (source && entry.geojson) source.setData(entry.geojson);
    }
  }

  function setLens(map, lens) {
    const active = LENSES[lens] || [];
    for (const id of Object.keys(global.AstanaLogic.config.sources)) {
      const visible = active.includes(id) ? 'visible' : 'none';
      for (const type of ['fill', 'line', 'point']) {
        const layerId = 'logic-' + id + '-' + type;
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible);
      }
    }
    if (map.getLayer('buildings-3d')) {
      map.setLayoutProperty('buildings-3d', 'visibility', lens === 'buildings' ? 'visible' : 'none');
    }
    const showProjects = ['traffic', 'roads', 'transit', 'schools', 'health', 'green'].includes(lens);
    for (const layerId of ['logic-project-points', 'logic-project-labels']) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', showProjects ? 'visible' : 'none');
    }
  }

  function setProjects(map, projects) {
    const source = map.getSource('logic-projects');
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: projects.map((project) => ({
        type: 'Feature', properties: { label: project.title, note: project.locationNote },
        geometry: { type: 'Point', coordinates: project.location }
      }))
    });
  }

  global.AstanaLogic.mapLayers = { init, setLens: (map, lens) => setLens(map, lens), lenses: LENSES };
})(window);

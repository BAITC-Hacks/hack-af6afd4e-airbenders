(function (global) {
  async function loadCityLayers(config) {
    const entries = Object.entries(config.sources);
    const results = await Promise.all(entries.map(async ([id, source]) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const geojson = await global.AstanaLogic.arcgis.fetchGeoJSON(source.url, { signal: controller.signal });
        return [id, { id, source, status: 'loaded', geojson, count: geojson.features.length, partial: geojson.metadata.partial }];
      } catch (error) {
        return [id, { id, source, status: 'unavailable', geojson: null, count: null, error: error.name === 'AbortError' ? 'timeout' : error.message }];
      } finally {
        clearTimeout(timer);
      }
    }));
    return Object.fromEntries(results);
  }

  function summarize(layers) {
    const values = Object.values(layers);
    return {
      loadedLayerCount: values.filter((layer) => layer.status === 'loaded').length,
      totalLayerCount: values.length,
      featureCount: values.reduce((total, layer) => total + (layer.count || 0), 0),
      byLayer: Object.fromEntries(values.map((layer) => [layer.id, {
        status: layer.status, count: layer.count, partial: Boolean(layer.partial), title: layer.source.title, error: layer.error || null
      }]))
    };
  }

  global.AstanaLogic.data = { loadCityLayers, summarize };
})(window);

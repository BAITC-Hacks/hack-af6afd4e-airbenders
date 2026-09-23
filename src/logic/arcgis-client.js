(function (global) {
  const PAGE_SIZE = 1500;
  const MAX_PAGES = 4;

  async function fetchGeoJSON(layerUrl, { signal } = {}) {
    const features = [];
    let offset = 0;
    let partial = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(layerUrl.replace(/\/$/, '') + '/query');
      url.search = new URLSearchParams({
        where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '4326',
        geometryPrecision: '6', resultOffset: String(offset), resultRecordCount: String(PAGE_SIZE), f: 'geojson'
      }).toString();

      const response = await fetch(url, { signal, headers: { Accept: 'application/geo+json, application/json' } });
      if (!response.ok) throw new Error('ArcGIS HTTP ' + response.status);
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || 'ArcGIS query failed');
      if (!Array.isArray(body.features)) throw new Error('ArcGIS вернул ответ не в формате GeoJSON');
      features.push(...body.features);
      const exceeded = Boolean(body.exceededTransferLimit || body.properties?.exceededTransferLimit);
      if (!exceeded && body.features.length < PAGE_SIZE) break;
      offset += body.features.length;
      if (page === MAX_PAGES - 1) partial = true;
    }

    return {
      type: 'FeatureCollection',
      features,
      metadata: { partial, fetchedAt: new Date().toISOString(), featureCount: features.length }
    };
  }

  global.AstanaLogic.arcgis = { fetchGeoJSON };
})(window);

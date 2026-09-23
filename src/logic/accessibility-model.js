(function (global) {
  const EARTH_RADIUS_METERS = 6371008.8;

  function distanceMeters(from, to) {
    if (!Array.isArray(from) || !Array.isArray(to) || from.length < 2 || to.length < 2 ||
        ![from[0], from[1], to[0], to[1]].every(Number.isFinite)) {
      throw new TypeError('Expected [longitude, latitude] coordinate pairs');
    }
    const radians = (degrees) => degrees * Math.PI / 180;
    const lat1 = radians(from[1]);
    const lat2 = radians(to[1]);
    const dLat = lat2 - lat1;
    const dLon = radians(to[0] - from[0]);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
  }

  // Straight-line proximity only. Network travel times and population coverage
  // need a routable graph and population locations before they can be reported.
  function nearestFacility(origin, facilities) {
    if (!Array.isArray(facilities) || facilities.length === 0) return { available: false, reason: 'no-facilities' };
    const ranked = facilities
      .filter((facility) => Array.isArray(facility.coordinates))
      .map((facility) => ({ facility, distanceMeters: distanceMeters(origin, facility.coordinates) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    if (!ranked.length) return { available: false, reason: 'no-geocoded-facilities' };
    return { available: true, facilityId: ranked[0].facility.id, distanceMeters: Math.round(ranked[0].distanceMeters), method: 'haversine-straight-line' };
  }

  function status() {
    return { available: false, reason: 'no-population-grid-or-routable-network', label: 'доступность не рассчитана' };
  }

  global.AstanaLogic.accessibility = { distanceMeters, nearestFacility, status };
})(window);

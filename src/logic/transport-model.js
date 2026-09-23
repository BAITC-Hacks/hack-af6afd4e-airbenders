(function (global) {
  const VERSION = 'BPR-1.0';

  // Bureau of Public Roads edge delay function. Requires measured/modelled demand
  // and road capacity; this prototype deliberately has no citywide inputs yet.
  function bprTravelTime({ freeFlowMinutes, volume, capacity, alpha = 0.15, beta = 4 }) {
    if (![freeFlowMinutes, volume, capacity, alpha, beta].every(Number.isFinite) ||
        freeFlowMinutes < 0 || volume < 0 || capacity <= 0 || alpha < 0 || beta <= 0) {
      return { available: false, reason: 'invalid-input', modelVersion: VERSION };
    }
    const vByC = volume / capacity;
    return {
      available: true,
      travelTimeMinutes: freeFlowMinutes * (1 + alpha * Math.pow(vByC, beta)),
      volumeCapacityRatio: vByC,
      modelVersion: VERSION,
      assumptions: ['BPR alpha=0.15, beta=4; road capacity and traffic volume must be supplied per link']
    };
  }

  function status() {
    return {
      available: false,
      reason: 'no-calibrated-network-or-demand',
      label: 'нет расчёта SUMO',
      modelVersion: VERSION
    };
  }

  global.AstanaLogic.transport = { bprTravelTime, status, version: VERSION };
})(window);

(function (global) {
  function run({ selectedProjectIds, layers }) {
    const config = global.AstanaLogic.config;
    const budget = global.AstanaLogic.budget.calculateBudget(
      config.projects, selectedProjectIds, config.demoBudgetLimitBnKzt
    );
    return {
      scenarioId: 'browser-demo-' + Date.now(),
      createdAt: new Date().toISOString(),
      resultStatus: 'budget-and-gis-only',
      budget,
      data: global.AstanaLogic.data.summarize(layers),
      transport: global.AstanaLogic.transport.status(),
      accessibility: global.AstanaLogic.accessibility.status(),
      assumptions: [
        'Лимит 120 млрд ₸ и цены проектов перенесены из макета и не подтверждены бюджетными документами.',
        'Координаты проектов демонстрационные; они не задают фактический участок строительства.',
        'Доступность учреждений и изменение трафика не рассчитаны.'
      ]
    };
  }

  global.AstanaLogic.scenario = { run };
})(window);

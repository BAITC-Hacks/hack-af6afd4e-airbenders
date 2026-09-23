(function (global) {
  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  function calculateBudget(projects, selectedIds, limitBnKzt) {
    const selected = projects.filter((project) => selectedIds.includes(project.id));
    const capexBnKzt = round(selected.reduce((sum, project) => sum + project.capexBnKzt, 0));
    const annualOpexKnown = selected.every((project) => Number.isFinite(project.annualOpexBnKzt));
    const annualOpexBnKzt = annualOpexKnown
      ? round(selected.reduce((sum, project) => sum + project.annualOpexBnKzt, 0))
      : null;

    return {
      selectedProjectIds: selected.map((project) => project.id),
      selectedCount: selected.length,
      capexBnKzt,
      demoLimitBnKzt: limitBnKzt,
      remainingDemoLimitBnKzt: round(limitBnKzt - capexBnKzt),
      annualOpexBnKzt,
      annualOpexStatus: annualOpexKnown ? 'provided' : 'missing',
      withinDemoLimit: capexBnKzt <= limitBnKzt,
      currency: 'KZT',
      unit: 'billion'
    };
  }

  global.AstanaLogic.budget = { calculateBudget };
})(window);

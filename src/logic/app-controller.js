(function (global) {
  const logic = global.AstanaLogic;
  const selected = new Set();
  let map = null;
  let mapLayers = null;
  let cityLayers = {};
  let activeLens = 'traffic';

  const lensMeta = {
    traffic: { label: 'ДОРОГИ · ГЕНПЛАН', title: 'Дороги · генплан' },
    roads: { label: 'ДОРОГИ · ГЕНПЛАН', title: 'Дороги · генплан' },
    transit: { label: 'МАРШРУТЫ · НЕТ ДАННЫХ', title: 'Маршруты общественного транспорта' },
    schools: { label: 'ШКОЛЫ · ГЕНПЛАН', title: 'Школы · генплан' },
    health: { label: 'ЗДРАВООХРАНЕНИЕ · ГЕНПЛАН', title: 'Здравоохранение · генплан' },
    green: { label: 'ЗЕЛЁНЫЕ ЗОНЫ · ГЕНПЛАН', title: 'Парки и озеленение · генплан' },
    districts: { label: 'РАЙОНЫ · ГИС', title: 'Районы Астаны · ГИС' },
    buildings: { label: 'ЗДАНИЯ 3D · OSM', title: 'Здания 3D · OpenStreetMap' },
    base: { label: 'БАЗА · OSM', title: 'Базовая карта' }
  };

  function element(selector) { return document.querySelector(selector); }
  function toast(message) {
    const node = element('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3500);
  }
  function formatBn(value) { return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }); }
  function pickedProjects() { return logic.config.projects.filter((project) => selected.has(project.id)); }
  function dataCount(id) {
    const layer = cityLayers[id];
    return layer?.status === 'loaded' ? layer.count.toLocaleString('ru-RU') + (layer.partial ? '+' : '') : 'нет данных';
  }

  function setupCopyAndControls() {
    element('.tag').textContent = '● GIS + 3D';
    element('.user').textContent = 'GIS / БАЗОВЫЙ СРЕЗ';
    const stats = [...document.querySelectorAll('.stats > div')];
    const statLabels = ['Районы ГИС', 'Дороги генплана', 'Школы в слоях', 'Дата набора'];
    const statValues = ['загрузка…', 'загрузка…', 'загрузка…', 'не задана'];
    stats.forEach((stat, index) => {
      stat.querySelector('small').textContent = statLabels[index];
      stat.querySelector('b').textContent = statValues[index];
    });
    element('.blk:nth-of-type(2) .label').textContent = 'Учебный лимит · ₸ млрд';
    element('.budget > small').textContent = 'демо-лимит 120';
    element('.run').textContent = '▶　Рассчитать бюджетный пакет';
    element('.blk:nth-of-type(2) .muted')?.remove();

    const disclaimer = document.createElement('div');
    disclaimer.className = 'muted scenario-note';
    disclaimer.style.marginTop = '10px';
    disclaimer.textContent = 'Суммы и точки проектов — допущения макета, не сметы и не свободный бюджет города.';
    element('.run').insertAdjacentElement('afterend', disclaimer);

    const lensButtons = [...document.querySelectorAll('.layer')];
    lensButtons.forEach((button) => {
      if (button.dataset.l === 'traffic') button.textContent = '⌁ Дороги';
      if (button.dataset.l === 'transit') button.textContent = '↗ Маршруты';
      if (button.dataset.l === 'schools') button.textContent = '⌂ Школы';
      if (button.dataset.l === 'green') button.textContent = '✳ Зелень';
      if (button.dataset.l === 'buildings') button.textContent = '▧ Здания 3D';
      if (button.dataset.l === 'base') button.textContent = '⌖ База';
    });
    const lensGrid = element('.layers');
    const addLens = (id, label) => {
      const button = document.createElement('button');
      button.className = 'layer';
      button.dataset.l = id;
      button.textContent = label;
      lensGrid.append(button);
    };
    addLens('health', '✚ Медицина');
    addLens('districts', '⬡ Районы');

    // Project order is intentionally mapped to the catalog by its visible list order.
    [...document.querySelectorAll('.proj')].forEach((node, index) => {
      const project = logic.config.projects[index];
      if (!project) return;
      node.dataset.projectId = project.id;
      node.dataset.n = String(project.capexBnKzt);
      node.querySelector('b').textContent = project.title;
      node.querySelector('small').textContent = project.sector + ' · оценка макета';
      if (node.classList.contains('on')) selected.add(project.id);
    });

    element('.right .card b').textContent = 'Данные GIS + арифметика сценария';
    element('.right h2').textContent = 'Бюджет и данные';
    element('.right .card p').textContent = 'Загрузка публичных слоёв генплана. Трафик, спрос и эффект проектов не считаются без калиброванной модели.';
    element('.right .status').textContent = '● ЗАГРУЗКА ГИС';
    element('.right .insight p').textContent = 'После появления проверенных результатов этот блок можно подключить к OpenAI API для объяснения причин. Сейчас AI не участвует в расчётах.';
    element('.right .foot').textContent = 'ГИС: сервисы e-Saulet; публичный доступ проверяется в браузере, лицензия в метаданных не указана. 3D-здания — OSM / OpenFreeMap. Проектные суммы и координаты демонстрационные.';

    const oldFinePrint = document.querySelector('.left .blk.muted');
    if (oldFinePrint) oldFinePrint.textContent = 'Здания показаны по данным OSM; высоты и детализация заполнены не везде.';
    refreshBudget();
    refreshResultRows(null);
  }

  function refreshBudget() {
    const budget = logic.budget.calculateBudget(logic.config.projects, [...selected], logic.config.demoBudgetLimitBnKzt);
    element('#amount').textContent = formatBn(budget.capexBnKzt);
    element('#bar').style.width = Math.max(0, Math.min(100, budget.capexBnKzt / budget.demoLimitBnKzt * 100)) + '%';
    element('#bar').style.background = budget.withinDemoLimit ? '#a7f27b' : '#f27760';
    const projects = pickedProjects();
    mapLayers?.setProjects(projects);
    if (!budget.withinDemoLimit) toast('Пакет выше учебного лимита. Уберите проекты или измените лимит в config.js.');
    return budget;
  }

  function refreshResultRows(result) {
    const rows = [...document.querySelectorAll('.right .row')];
    const budget = result?.budget || logic.budget.calculateBudget(logic.config.projects, [...selected], logic.config.demoBudgetLimitBnKzt);
    const gis = result?.data || logic.data.summarize(cityLayers);
    const values = [
      ['Выбранные проекты', String(budget.selectedCount)],
      ['CAPEX по допущениям, ₸ млрд', formatBn(budget.capexBnKzt)],
      ['Остаток учебного лимита, ₸ млрд', formatBn(budget.remainingDemoLimitBnKzt)],
      ['Объекты загруженных GIS-слоёв', gis.loadedLayerCount ? gis.featureCount.toLocaleString('ru-RU') : 'загрузка…'],
      ['Трафик / SUMO', 'не рассчитан']
    ];
    while (rows.length < values.length) {
      const row = document.createElement('div');
      row.className = 'row';
      element('.right .insight').before(row);
      rows.push(row);
    }
    values.forEach(([label, value], index) => {
      rows[index].innerHTML = '<span></span><b></b>';
      rows[index].querySelector('span').textContent = label;
      rows[index].querySelector('b').textContent = value;
    });
    if (result) {
      element('.right .status').textContent = result.budget.withinDemoLimit ? '● РАСЧЁТ ГОТОВ' : '● ЛИМИТ ПРЕВЫШЕН';
      element('.right .card b').textContent = 'Финансовая часть посчитана локально';
      element('.right .card p').textContent = result.budget.withinDemoLimit
        ? 'Учтён CAPEX выбранных проектов и остаток учебного лимита. OPEX и бюджетные назначения не заданы; городской эффект не рассчитывался.'
        : 'Сумма выбранных проектов превышает учебный лимит. Это не проверка реального бюджета Астаны.';
    } else if (Object.keys(cityLayers).length) {
      element('.right .status').textContent = gis.loadedLayerCount + '/' + gis.totalLayerCount + ' СЛОЁВ ГИС';
      element('.right .card b').textContent = 'Сценарий не запущен';
      element('.right .card p').textContent = 'CAPEX и остаток учебного лимита пересчитываются по выбранным проектам. Городские эффекты не моделируются.';
    }
  }

  function setLens(lens) {
    activeLens = lens;
    document.querySelectorAll('.layer').forEach((button) => button.classList.toggle('on', button.dataset.l === lens));
    const meta = lensMeta[lens] || lensMeta.base;
    element('#active').textContent = meta.label;
    element('#legend').innerHTML = '<b>' + meta.title.toLocaleUpperCase('ru-RU') + '</b><div id="legend-detail">Загрузка геослоя…</div>';
    if (mapLayers) mapLayers.setLens(lens);
    updateLegend(lens);
  }

  function updateLegend(lens) {
    const detail = element('#legend-detail');
    if (!detail) return;
    if (lens === 'transit') { detail.textContent = 'Нет загруженного маршрутного набора.'; return; }
    if (lens === 'traffic') { detail.textContent = 'Линии генплана; это не загруженность движения.'; return; }
    if (lens === 'roads') { detail.textContent = 'Публичный слой генплана, без интенсивности движения.'; return; }
    if (lens === 'buildings') { detail.textContent = 'Контуры и высоты из тайлов OpenStreetMap.'; return; }
    if (lens === 'base') { detail.textContent = 'Базовая карта OpenFreeMap / OpenStreetMap.'; return; }
    const ids = (logic.mapLayers.lenses[lens] || []);
    const loaded = ids.map((id) => cityLayers[id]).filter((layer) => layer?.status === 'loaded');
    const failed = ids.length - loaded.length;
    detail.textContent = loaded.length
      ? loaded.map((layer) => layer.source.title + ': ' + layer.count.toLocaleString('ru-RU') + (layer.partial ? '+' : '')).join(' · ') + (failed ? ' · часть слоёв недоступна' : '')
      : 'Геослой не загрузился. Проверьте доступность сервиса и CORS.';
  }

  function onMapReady(mapInstance) {
    map = mapInstance;
    mapLayers = logic.mapLayers.init(map, logic.config.sources, cityLayers);
    setLens(activeLens);
    mapLayers.setProjects(pickedProjects());
  }

  async function loadData() {
    cityLayers = await logic.data.loadCityLayers(logic.config);
    if (map) {
      Object.entries(cityLayers).forEach(([id, entry]) => {
        const source = map.getSource('logic-' + id);
        if (source && entry.geojson) source.setData(entry.geojson);
      });
    }
    const summary = logic.data.summarize(cityLayers);
    const stats = [...document.querySelectorAll('.stats > div')];
    if (stats[0]) stats[0].querySelector('b').textContent = dataCount('districts');
    if (stats[1]) stats[1].querySelector('b').textContent = dataCount('roads');
    const current = cityLayers.schoolsCurrent;
    const planned = cityLayers.schoolsPlanned;
    if (stats[2]) stats[2].querySelector('b').textContent = current?.status === 'loaded' && planned?.status === 'loaded'
      ? (current.count + planned.count).toLocaleString('ru-RU') : 'частично нет данных';
    element('.right .status').textContent = summary.loadedLayerCount + '/' + summary.totalLayerCount + ' СЛОЁВ ГИС';
    element('.right .card p').textContent = summary.loadedLayerCount
      ? `Доступно ${summary.loadedLayerCount} из ${summary.totalLayerCount} GIS-слоёв (${summary.featureCount.toLocaleString('ru-RU')} объектов). Публичный доступ не подтверждает лицензию набора.`
      : 'GIS-сервисы не ответили из браузера. Проверьте сеть/CORS; финансовые расчёты сценария работают отдельно.';
    updateLegend(activeLens);
    refreshResultRows(null);
  }

  function handleClicks(event) {
    const projectNode = event.target.closest('.proj');
    const lensNode = event.target.closest('.layer');
    const runButton = event.target.closest('#run');
    if (projectNode) {
      event.preventDefault(); event.stopImmediatePropagation();
      const id = projectNode.dataset.projectId;
      projectNode.classList.toggle('on');
      projectNode.classList.contains('on') ? selected.add(id) : selected.delete(id);
      refreshBudget();
      refreshResultRows(null);
    } else if (lensNode) {
      event.preventDefault(); event.stopImmediatePropagation();
      setLens(lensNode.dataset.l);
    } else if (runButton) {
      event.preventDefault(); event.stopImmediatePropagation();
      const result = logic.scenario.run({ selectedProjectIds: [...selected], layers: cityLayers });
      refreshResultRows(result);
      toast(result.budget.withinDemoLimit
        ? 'Расчёт CAPEX завершён. Транспортный и социальный эффект пока не рассчитан.'
        : 'CAPEX превышает учебный лимит. Сценарий не проходит финансовую проверку.');
    }
  }

  function init() {
    setupCopyAndControls();
    document.addEventListener('click', handleClicks, true);
    refreshBudget();
    setLens(activeLens);
    loadData().catch((error) => console.error('GIS load failed', error));
  }

  global.AstanaApp = { init, onMapReady };
  init();
})(window);

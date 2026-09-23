(function () {
  const $ = selector => document.querySelector(selector);
  const api = window.SimulationAPI;
  const map = window.PilotMap;
  let catalog = [], selected = new Set(['brt', 'school-esil']), busy = false, result = null, lens = 'traffic', mode = 'after';
  let snapshot = null, jobId = null;
  const number = (n, digits = 1) => n == null ? '—' : (Math.abs(n) < 0.5 * 10 ** -digits ? 0 : Number(n)).toLocaleString('ru-RU', { maximumFractionDigits: digits });
  const signed = n => n == null ? '—' : (n > 0 ? '+' : '') + number(n);
  function status(message, error = false) { $('#status').textContent = message; $('#status').classList.toggle('invalid', error); }
  function options() {
    return { selectedProjectIds: [...selected], seed: Number($('#seed').value), vehicles: Number($('#vehicles').value),
      demandSeconds: Number($('#period').value), busHeadwaySeconds: Number($('#headway').value),
      yearlyBudgetBnKzt: Number($('#budget').value), horizonYears: Number($('#years').value) };
  }
  function chosen() { return catalog.filter(p => selected.has(p.id)); }
  function lock(value) {
    busy = value;
    document.querySelectorAll('.left input,.left select,.left button').forEach(node => node.disabled = value);
    $('#progress').hidden = !value;
    $('#run').textContent = value ? 'SUMO работает…' : '▶ Рассчитать в SUMO';
  }
  function updateBudget() {
    const opt = options(), projects = chosen();
    const capex = projects.reduce((sum, p) => sum + p.capexBnKzt, 0);
    const annual = projects.reduce((sum, p) => sum + p.annualOpexBnKzt, 0);
    $('#capex').textContent = number(capex) + ' млрд ₸';
    $('#opex').textContent = number(annual * opt.horizonYears, 2) + ' млрд ₸';
    const remaining = opt.yearlyBudgetBnKzt - capex - annual;
    $('#budget-status').textContent = 'Остаток первого года: ' + number(remaining, 2) + ' млрд ₸';
    $('#budget-status').classList.toggle('invalid', remaining < 0);
    map.update({ projects });
  }
  function invalidate() {
    result = null;
    $('#results').replaceChildren();
    $('#download').hidden = true;
    $('#assumption-list').replaceChildren();
    status('Параметры изменены — запустите расчёт');
    $('#summary').textContent = 'Будут рассчитаны два сценария с одинаковыми поездками и выбранными параметрами.';
    map.update({ result: null, layers: {} });
    updateBudget();
    legend();
  }
  function legend() {
    const titles = { traffic: 'Транспорт · скорость SUMO', school: 'Школы · пешая доступность', clinic: 'Медицина · пешая доступность', park: 'Парки · пешая доступность', buildings: 'Здания · OpenStreetMap' };
    $('#legend-title').textContent = titles[lens];
    $('#legend-text').textContent = lens === 'buildings' ? 'Высоты из OSM, при отсутствии данных — 8 м.' : !result
      ? 'Выберите проекты и запустите расчёт. Голубые точки — существующие объекты, крупные зелёные — проекты.'
      : lens === 'traffic' ? mode === 'delta'
        ? 'Зелёный: скорость выросла. Красный: упала. Серый: нет сопоставимых проездов. Фиолетовый пунктир: автобусный коридор.'
        : 'Скорость: красный <20, жёлтый ~20, зелёный ~45, голубой >70 км/ч. Серый: нет проездов.'
      : mode === 'delta' ? 'Зелёные контрольные точки получили доступ за 15 минут. Остальные — серые.'
        : 'Контрольные точки: зелёный ≤15 минут пешком, красный >15, серый — нет пути. Голубые точки — объекты OSM.';
  }
  function group(title) {
    const section = document.createElement('section'); section.className = 'result-group';
    const h = document.createElement('h3'); h.textContent = title; section.append(h); $('#results').append(section); return section;
  }
  function metric(parent, title, value, note = '') {
    const node = document.createElement('div'); node.className = 'metric';
    for (const [tag, text] of [['span', title], ['strong', value], ['small', note]]) {
      if (!text) continue;
      const child = document.createElement(tag); child.textContent = text; node.append(child);
    }
    parent.append(node);
  }
  function paired(parent, title, value, unit = 'с') {
    metric(parent, title, `${number(value.before)} → ${number(value.after)} ${unit}`, `Изменение: ${signed(value.delta)} ${unit}`);
  }
  function renderResult(data) {
    result = data;
    $('#results').replaceChildren();
    const t = data.transport;
    status(t.comparisonComplete ? 'Расчёт завершён · все поездки закончены' : 'Расчёт завершён · есть незавершённые поездки', !t.comparisonComplete);
    const cars = group('Автомобили · до → после');
    paired(cars, 'Среднее время в пути', t.paired.car.duration);
    paired(cars, 'Потери времени в движении', t.paired.car.delay);
    paired(cars, 'Задержка перед выездом', t.paired.car.departDelay);
    metric(cars, 'Завершено / запланировано', `${t.before.car.completed} → ${t.after.car.completed} / ${data.options.vehicles}`, `Сопоставлены ${t.paired.car.pairedCompletedTrips} одинаковых поездок`);
    const buses = group('Автобусы · условный маршрут');
    paired(buses, 'Время поездки, включая остановки', t.paired.bus.duration);
    paired(buses, 'Потери времени в движении', t.paired.bus.delay);
    metric(buses, 'Завершено автобусов', `${t.before.bus.completed} → ${t.after.bus.completed}`, `Сопоставлены ${t.paired.bus.pairedCompletedTrips} поездок`);
    const environment = group('Транспортные выбросы');
    metric(environment, 'CO₂ за прогон, кг', `${number(t.before.co2Kg)} → ${number(t.after.co2Kg)}`, `Δ ${signed(t.co2DeltaKg)} кг. ${t.comparisonComplete ? 'Один и тот же спрос.' : 'Разный объём завершённых поездок: сравнение ограничено.'}`);
    if (data.accessibility.available) {
      const access = group('Пешком за 15 минут');
      for (const [key, title] of [['school', 'Школы'], ['clinic', 'Медицина'], ['park', 'Парки']]) {
        const v = data.accessibility.metrics[key];
        metric(access, title + ' · доля контрольных точек', `${number(v.before.coveredPercent)}% → ${number(v.after.coveredPercent)}%`, `Δ ${signed(v.deltaPercentagePoints)} п.п. · ${v.before.totalSamples} точек; это не доля жителей`);
        if (v.improvedSamples != null) metric(access, title + ' · медиана пути, мин', `${number(v.before.medianMinutes)} → ${number(v.after.medianMinutes)}`, `Путь сократился у ${v.improvedSamples} контрольных точек`);
      }
    }
    const finance = group('Бюджет · млрд ₸');
    for (const year of data.budget.years) metric(finance, 'Год ' + year.year, 'Остаток ' + number(year.remainingBnKzt, 2), `CAPEX ${number(year.capexBnKzt)} · OPEX ${number(year.opexBnKzt, 2)}`);
    const assumptions = [...data.assumptions, ...data.budget.assumptions, ...(data.accessibility.assumptions || []), data.sumoVersion];
    $('#assumption-list').replaceChildren();
    for (const text of assumptions) { const li = document.createElement('li'); li.textContent = text; $('#assumption-list').append(li); }
    $('#summary').textContent = `${data.corridor.street}: ${number(data.corridor.lengthMeters / 1000)} км коридора. Seed ${data.options.seed}; ${data.options.demandSeconds / 60} минут отправления. Результат при синтетическом спросе.`;
    $('#download').href = '/api/v1/runs/' + data.jobId + '/results';
    $('#download').hidden = false;
    map.update({ result: data, corridor: data.corridor });
    legend();
  }
  async function loadSnapshot() {
    snapshot = await api.request('/city/snapshot');
    const m = snapshot.metadata;
    $('#snapshot-info').textContent = `OSM: ${(m.osmTimestamp || m.downloadedAt).slice(0, 10)} · загружен ${m.downloadedAt.slice(0, 10)} · ${snapshot.facilities.length} объектов`;
    $('#corridor-info').textContent = `Автобусный коридор: ${snapshot.corridor.street}, ${number(snapshot.corridor.lengthMeters / 1000)} км. Учебный проект.`;
    $('#prepare').textContent = '✓ Снимок OSM подготовлен';
    map.update({ facilities: snapshot.facilities, corridor: snapshot.corridor });
  }
  function restoreOptions(opt) {
    selected = new Set(opt.selectedProjectIds);
    for (const [id, field] of [['seed', 'seed'], ['vehicles', 'vehicles'], ['period', 'demandSeconds'], ['headway', 'busHeadwaySeconds'], ['budget', 'yearlyBudgetBnKzt'], ['years', 'horizonYears']]) $('#' + id).value = opt[field];
    document.querySelectorAll('[data-project]').forEach(node => node.checked = selected.has(node.dataset.project));
    updateBudget();
  }
  async function follow(id) {
    jobId = id;
    localStorage.setItem('astana-running-job', id);
    const data = await api.wait(id, message => status(message));
    await loadSnapshot();
    if (data.transport) {
      restoreOptions(data.options);
      renderResult(data);
      const entries = await Promise.all(data.layerNames.map(async name => [name, await api.request('/runs/' + id + '/layers/' + name)]));
      map.update({ layers: Object.fromEntries(entries) });
    } else status('OSM готов — выберите проекты и запустите SUMO');
    localStorage.removeItem('astana-running-job');
    if (data.transport) {
      localStorage.setItem('astana-last-result', id);
      history.replaceState(null, '', '?run=' + id);
    }
  }
  async function launch(prepare = false) {
    if (busy) return;
    if (!prepare && ![...document.querySelectorAll('.left input[type=number]')].every(node => node.reportValidity())) return;
    lock(true);
    if (!prepare) invalidate();
    status(prepare ? 'Подготовка OSM…' : 'Запуск расчёта…');
    try {
      const task = await api.request(prepare ? '/prepare' : '/scenarios/run', prepare ? {} : options());
      await follow(task.jobId);
    } catch (error) { status(error.message, true); }
    finally { lock(false); }
  }
  async function init() {
    lock(true);
    try { map.init(); } catch (error) { $('#map-error').hidden = false; $('#map-error').textContent = error.message; }
    $('#run').onclick = () => launch(); $('#prepare').onclick = () => launch(true); $('#home').onclick = () => map.home();
    document.querySelectorAll('[data-lens]').forEach(button => button.onclick = () => {
      lens = button.dataset.lens; document.querySelectorAll('[data-lens]').forEach(b => b.classList.toggle('selected', b === button)); map.update({ lens }); legend();
    });
    document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
      mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b === button)); map.update({ mode }); legend();
    });
    document.querySelectorAll('.left input,.left select').forEach(node => node.addEventListener('change', invalidate));
    try {
      const [health, catalogData] = await Promise.all([api.request('/health'), api.request('/projects/catalog')]);
      catalog = catalogData.projects;
      for (const project of catalog) {
        const label = document.createElement('label'); label.className = 'project';
        const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.project = project.id; check.checked = selected.has(project.id);
        check.onchange = () => { check.checked ? selected.add(project.id) : selected.delete(project.id); invalidate(); };
        const text = document.createElement('div'), title = document.createElement('b'), cost = document.createElement('small');
        title.textContent = project.title; cost.textContent = `${project.capexBnKzt} млрд ₸ · содержание ${project.annualOpexBnKzt} млрд/год`;
        text.append(title, cost); label.append(check, text); $('#projects').append(label);
      }
      lock(true);
      $('#connection').textContent = health.sumoInstalled ? '● SUMO подключён' : 'SUMO не установлен';
      updateBudget();
      if (health.snapshotReady) await loadSnapshot();
      const linkedRun = new URLSearchParams(location.search).get('run');
      const pending = health.activeJobId || localStorage.getItem('astana-running-job') || linkedRun || localStorage.getItem('astana-last-result');
      if (pending) {
        lock(true);
        try { await follow(pending); }
        catch (error) { localStorage.removeItem('astana-running-job'); localStorage.removeItem('astana-last-result'); status(error.message + ' Можно запустить новый расчёт.', true); }
      }
      else status(health.sumoInstalled ? 'Готов к расчёту' : 'Установите requirements.txt и перезапустите сервер', !health.sumoInstalled);
    } catch (error) {
      status('Не удалось подключиться: ' + error.message + '. Запуск: .venv\\Scripts\\python.exe -m server', true);
      $('#connection').textContent = 'Сервер недоступен';
    } finally { lock(false); }
  }
  init();
})();

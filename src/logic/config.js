(function (global) {
  const genPlan = 'https://gis.esaulet.kz/server/rest/services/Hosted/gen_plan5/FeatureServer';

  global.AstanaLogic = global.AstanaLogic || {};
  global.AstanaLogic.config = {
    version: '0.1.0',
    demoBudgetLimitBnKzt: 120,
    sources: {
      districts: { url: 'https://gis.esaulet.kz/server/rest/services/Hosted/raiony/FeatureServer/0', title: 'Районы Астаны', kind: 'polygon' },
      roads: { url: genPlan + '/3', title: 'Дороги генплана', kind: 'line' },
      parks: { url: genPlan + '/7', title: 'Парки генплана', kind: 'polygon' },
      schoolsPlanned: { url: genPlan + '/45', title: 'Школы генплана · проект', kind: 'point' },
      schoolsCurrent: { url: genPlan + '/46', title: 'Школы генплана · существующие', kind: 'point' },
      healthPlanned: { url: genPlan + '/47', title: 'Здравоохранение генплана · проект', kind: 'point' },
      healthCurrent: { url: genPlan + '/48', title: 'Здравоохранение генплана · существующие', kind: 'point' },
      green: { url: genPlan + '/64', title: 'Озеленение генплана', kind: 'polygon' }
    },
    // Это стартовые числа из макета, а не утверждённые сметы или бюджетные назначения.
    projects: [
      { id: 'brt', title: 'BRT · выделенные полосы', sector: 'транспорт', capexBnKzt: 18, location: [71.431, 51.129], locationNote: 'условная точка демонстрации' },
      { id: 'school-esil', title: 'Школа в Есильском районе', sector: 'образование', capexBnKzt: 12, location: [71.453, 51.158], locationNote: 'условная точка демонстрации' },
      { id: 'park', title: 'Парк и зелёный коридор', sector: 'экология', capexBnKzt: 9, location: [71.477, 51.108], locationNote: 'условная точка демонстрации' },
      { id: 'clinic-nura', title: 'Поликлиника в Нура', sector: 'здоровье', capexBnKzt: 15, location: [71.412, 51.17], locationNote: 'условная точка демонстрации' }
    ]
  };
})(window);

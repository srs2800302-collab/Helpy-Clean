// Test-only language editions and reference data. Not launch content or linguistic approval.
export const ratio = (numerator, denominator = 100n) => ({ numerator, denominator });
export const policy = (changes = {}) => ({
  version: 'test-policy-1', effectiveAt: 0, initialDuration: 24 * 3600, initialAutoClose: true,
  repeatDurations: [12 * 3600, 6 * 3600, 3 * 3600], repeatFloor: 3 * 3600,
  negotiationFirstReminder: 3600, negotiationRepeatReminder: 3600, paymentSelectionTimeout: 600,
  clientPaymentRoutes: ['promptpay', 'cash', 'bank_transfer', 'wallet', 'card'],
  masterPayoutRoutes: ['bank_transfer'], commission: ratio(30n), globalDebtThreshold: 1000n,
  mutualCancellationFee: ratio(15n), falseCallFee: ratio(30n), falseCallMasterShare: ratio(50n),
  cancellationResponse: 8 * 3600, cancellationReminder: 30 * 60,
  inactivityFirstReminder: 36 * 3600, inactivityRepeatReminder: 6 * 3600, inactivityThreshold: 120 * 3600,
  historyLimit: 60, communicationRetention: { value: 90, unit: 'days' }, evidenceRetention: { value: 90, unit: 'days' },
  financialRetention: { value: 1, unit: 'years' }, auditRetention: { value: 1, unit: 'years' }, accountRetention: { value: 1, unit: 'years' },
  locales: ['th', 'ru', 'en'], ...changes,
});
const groups = [
  ['air', 'scenario_first', ['air-service', 'air-install', 'air-replace']],
  ['cleaning', 'terminal', ['regular', 'deep', 'post-repair']],
  ['plumbing', 'equipment', ['faucet', 'toilet', 'shower']],
  ['electrical', 'repeatable_points', ['socket', 'switch']],
  ['locks', 'equipment', ['door-lock', 'furniture-lock']],
  ['furniture', 'structured', ['kitchen', 'cabinet', 'built-in-furniture', 'disassembly']],
  ['appliance', 'equipment', ['washer', 'dishwasher', 'disposer']],
  ['built-in', 'equipment_list', ['bi-sink', 'bi-faucet', 'bi-heater', 'bi-disposer', 'bi-hob', 'bi-oven', 'bi-microwave', 'bi-hood', 'bi-fridge', 'bi-dishwasher', 'bi-washer']],
];
export const sourceRules = [
  ['materials', 3268, 'В стоимость заказа входят только работы, предусмотренные согласованным объёмом услуги.'],
  ['materials-extra', 3269, 'Дополнительные материалы, комплектующие и расходные материалы являются отдельной договорённостью между клиентом и мастером.'],
  ['electrical', 3284, 'Поиск неисправностей существующей электропроводки не входит в объём услуги установки.'],
  ['quality', 3311, 'Базовая работоспособность результата должна быть подтверждена в рамках согласованного объёма заказа.'],
  ['safe-client', 3847, 'Клиент отвечает только на вопросы, которые он объективно может понять.'],
  ['packaging', 3856, 'Если клиент уже приобрёл новое оборудование самостоятельно, Helpy не требует вскрытия упаковки до проверки совместимости мастером.'],
  ['compatibility', 3866, 'Если работа предполагает замену оборудования, мастер обязан проверить новое оборудование до демонтажа существующего.'],
  ['cleaning', 8223, 'Внутренняя уборка мебели выполняется только для пустой и подготовленной мебели.'],
  ['air', 8466, 'Мастер не выполняет работы на высоте без подходящего оборудования и безопасных условий.'],
  ['kitchen', 7357, 'Для установки и подключения встроенной бытовой техники необходимо создать отдельный заказ в соответствующей категории.'],
  ['disposer', 1261, 'Мастер не должен использовать гофрированные элементы водоотведения.'],
  ['ownership', 'F2:3.6', 'При замене демонтированное оборудование остаётся собственностью клиента и остаётся на объекте, если стороны не согласовали иное'],
];
export function catalog({ approved = true, version = 1 } = {}) {
  const texts = [];
  const text = (id, ru = id) => {
    if (!texts.some(value => value.id === id)) texts.push({ id, revision: 1, meaning: 1,
      editions: Object.fromEntries(['th', 'ru', 'en'].map(locale => [locale, { text: `TEST ONLY ${locale}: ${ru}`, revision: 1, approvedBy: approved ? 'test-admin' : null }])) });
    return id;
  };
  const question = (id, kind = 'boolean', extra = {}) => ({ id, textId: text(`q:${id}`), required: true, kind, ...extra });
  const choice = (id, values, extra = {}) => question(id, 'choice', { choices: values.map(id => ({ id, textId: text(`choice:${id}`) })), ...extra });
  const photo = (id, minimum = 1, extra = {}) => ({ id: `photo:${id}`, textId: text(`p:${id}`), minimum, formats: ['image/jpeg'], ...extra });
  const categories = [], entities = [], scenarios = [];
  for (const [categoryId, architecture, ids] of groups) {
    categories.push({ id: categoryId, architecture, title: text(`category:${categoryId}`), description: text(`description:${categoryId}`), enabled: true, order: categories.length });
    for (const id of ids) {
      const actions = categoryId === 'air' ? [id === 'air-service' ? 'service' : id === 'air-install' ? 'install_connect' : 'replace'] :
        categoryId === 'cleaning' ? ['clean'] : categoryId === 'furniture' ? [id === 'disassembly' ? 'disassemble' : 'assemble'] :
          categoryId === 'electrical' ? ['install_connect', 'replace', 'relocate'] : ['install_connect', 'replace'];
      entities.push({ id, categoryId, title: text(`entity:${id}`), description: text(`entity-description:${id}`), enabled: true, order: ids.indexOf(id), scenarioIds: actions.map(action => `${id}:${action}`) });
      for (const action of actions) {
        const form = { id: `form:${id}:${action}`, questions: [], photos: [], tables: [], routes: [], stops: [], linkedCategories: [] };
        if (categoryId === 'cleaning') {
          form.questions.push(question('object', 'choice', { choices: ['condo', 'flat', 'house', 'townhouse', 'other'].map(id => ({ id, textId: text(id) })) }),
            choice('area', ['up-to-30', '31-50', '51-80', '81-120', 'over-120']), question('balcony'), question('clean-balcony', 'boolean', { when: [{ questionId: 'balcony', equals: true }] }),
            choice('balcony-area', ['up-to-3', '4-6', '7-10', 'over-10'], { when: [{ questionId: 'balcony', equals: true }, { questionId: 'clean-balcony', equals: true }] }));
          if (id === 'post-repair') { form.questions.push(question('repair-completed')); form.stops.push({ id: 'repair-stop', when: [{ questionId: 'repair-completed', equals: false }], textId: text('repair-incomplete', 'Уборка после ремонта выполняется только после завершения ремонтных работ.') }); }
          else { form.questions.push(question('pets'), question('pet-types', 'text', { when: [{ questionId: 'pets', equals: true }] })); if (id === 'deep') form.questions.push(question('empty')); }
          form.photos.push(photo('kitchen', 1, { maximum: 1 }), photo('bathroom', 2, { maximum: 2 }), photo('bedroom', 2, { maximum: 2 }), photo('living-room', 0, { maximum: 1 }),
            photo('balcony', 0, { maximum: 1, when: [{ questionId: 'balcony', equals: true }, { questionId: 'clean-balcony', equals: true }] }), photo('additional', 0, { maximum: 3 }));
        }
        if (categoryId === 'air') {
          if (id === 'air-service') form.questions.push(question('count', 'integer'), question('outdoor-access'));
          else {
            form.questions.push(choice('outdoor-location', ['balcony', 'ground', 'facade', 'roof', 'other']), question('outdoor-location-other', 'text', { when: [{ questionId: 'outdoor-location', equals: 'other' }] }));
            if (action === 'install_connect') form.questions.push(choice('wall', ['concrete', 'brick', 'aerated', 'drywall', 'other']),
              question('wall-layers', 'integer', { when: [{ questionId: 'wall', equals: 'drywall' }] }), question('wall-other', 'text', { when: [{ questionId: 'wall', equals: 'other' }] }));
            else {
              form.questions.push(question('new-on-site'), choice('new-equipment', ['new', 'used', 'unknown']), question('old-installed'), question('same-location'), question('outdoor-access'));
              for (const when of [[{ questionId: 'new-on-site', equals: false }], [{ questionId: 'new-equipment', equals: 'used' }], [{ questionId: 'new-equipment', equals: 'unknown' }]]) form.stops.push({ id: `new-equipment-stop:${form.stops.length}`, when, textId: text('new-equipment-required') });
              form.routes.push({ id: 'air-install-route', when: [{ questionId: 'old-installed', equals: false }], target: { categoryId, entityId: 'air-install', scenarioId: 'air-install:install_connect' } });
            }
          }
          form.photos.push(photo('equipment', 1, { maximum: id === 'air-service' ? 5 : id === 'air-replace' ? 2 : 1 }));
          if (id === 'air-service') form.photos.push(photo('outdoor', 0, { maximum: 5, when: [{ questionId: 'outdoor-access', equals: true }] }));
          else if (id === 'air-install') form.photos.push(photo('technical', 2, { maximum: 4 }), photo('location', 1, { maximum: 1 }), photo('outdoor', 0, { maximum: 2 }), photo('connection', 1, { maximum: 2 }));
          else form.photos.push(photo('technical', 2, { maximum: 4 }), photo('location', 1, { maximum: 2 }), photo('outdoor', 1, { maximum: 2 }));
        }
        if (categoryId === 'electrical') {
          form.questions.push(question('quantity', 'integer'), question('mounting', 'choice', { choices: ['surface', 'internal', 'unknown'].map(id => ({ id, textId: text(id) })) }));
          form.photos.push(photo('equipment', 1, { maximum: action === 'relocate' ? 4 : 3 }), photo('point', 1, { maximum: 4 }));
          if (action !== 'relocate') form.photos.push(photo('zone', 1, { maximum: 3 })); else form.photos.push(photo('new-equipment', 0, { maximum: 2 }));
        }
        if (categoryId === 'plumbing' || categoryId === 'locks') {
          form.questions.push(question('on-site')); form.stops.push({ id: 'on-site-stop', when: [{ questionId: 'on-site', equals: false }], textId: text('equipment-absent') });
          if (id === 'faucet') form.questions.push(choice('location', ['sink', 'kitchen', 'shower', 'balcony']));
          if (id === 'shower') form.questions.push(question(action === 'install_connect' ? 'hose-purchased' : 'new-hose-needed'));
          if (id === 'door-lock' && action === 'install_connect') form.questions.push(question('previous-lock'));
          if (id === 'furniture-lock') form.questions.push(question('furniture-description', 'text'));
          form.photos.push(photo('equipment', 1, { maximum: 1 }), photo('technical', 1, { maximum: 4 }), photo('location', 1, { maximum: id === 'toilet' && action === 'replace' ? 2 : 1 }));
          if (id === 'faucet') {
            form.photos.push(photo('water-connection', 1, { maximum: 1 }));
            for (const [name, minimum, location] of [['distance-sink', 1, 'sink'], ['under-sink', 0, 'sink'], ['under-kitchen', 1, 'kitchen'], ['distance-kitchen', 0, 'kitchen'], ['installation-shower', 1, 'shower']]) form.photos.push(photo(name, minimum, { maximum: 1, when: [{ questionId: 'location', equals: location }] }));
            if (action === 'replace') { form.photos.push(photo('installed-faucet', 1, { maximum: 1 })); for (const location of ['sink', 'kitchen']) form.photos.push(photo(`mounting-${location}`, 0, { maximum: 1, when: [{ questionId: 'location', equals: location }] })); }
          }
          if (id === 'shower') form.photos.push(photo('water-connection', 1, { maximum: 1 }), photo('electrical-connection', 1, { maximum: 1 }));
          if (id === 'toilet') form.photos.push(photo('water-connection', 1, { maximum: 1 }), photo('drain', 1, { maximum: 1 }));
          if (id === 'door-lock') {
            form.photos.push(photo('reverse-side', 1, { maximum: 1 }));
            if (action === 'replace') form.photos.push(photo('door-edge', 1, { maximum: 1 }));
            else for (const name of ['door-edge', 'door-frame']) form.photos.push(photo(name, 1, { maximum: 1, when: [{ questionId: 'previous-lock', equals: true }] }));
          }
          if (id === 'furniture-lock') { form.photos.push(photo('reverse-side', 1, { maximum: 1 })); if (action === 'replace') form.photos.push(photo('installed-lock', 1, { maximum: 1 })); }
        }
        if (categoryId === 'appliance') {
          if (id !== 'disposer') { form.questions.push(question('built-in')); form.routes.push({ id: 'built-in-route', when: [{ questionId: 'built-in', equals: true }], target: { categoryId: 'built-in', entityId: `bi-${id}`, scenarioId: `bi-${id}:${action}` } }); }
          else if (action === 'install_connect') { form.questions.push(question('sink-installed')); form.stops.push({ id: 'sink-stop', when: [{ questionId: 'sink-installed', equals: false }], textId: text('sink-required') }); }
          else { form.questions.push(question('old-installed')); form.routes.push({ id: 'install-route', when: [{ questionId: 'old-installed', equals: false }], target: { categoryId, entityId: id, scenarioId: `${id}:install_connect` } }); }
          form.photos.push(photo('equipment', 1, { maximum: 1 }), photo('technical', 2, { maximum: 4 }), photo('location', 1, { maximum: id === 'disposer' ? 2 : 1 }));
          if (id !== 'disposer') form.photos.push(photo('connection', 1, { maximum: 3 }));
          else if (action === 'install_connect') form.photos.push(photo('under-sink', 1, { maximum: 2 }), photo('electrical-connection', 1, { maximum: 2 }));
        }
        if (categoryId === 'built-in') {
          if (['bi-oven', 'bi-microwave', 'bi-fridge', 'bi-dishwasher', 'bi-washer'].includes(id) && action === 'install_connect') form.questions.push(question('niche', 'dimensions'));
          if (['bi-fridge', 'bi-dishwasher', 'bi-washer'].includes(id)) {
            if (action === 'replace') form.questions.push(question('new-facade'));
            form.photos.push(photo('facade', 1, { maximum: id === 'bi-fridge' ? 2 : 1, ...(action === 'replace' ? { when: [{ questionId: 'new-facade', equals: true }] } : {}) }));
          }
          if (id === 'bi-hood') { form.questions.push(question('ventilation')); if (action === 'install_connect') form.photos.push(photo('vent', 1, { maximum: 2, when: [{ questionId: 'ventilation', equals: true }] })); }
          form.photos.push(photo('equipment', 1, { maximum: 1 }), photo('technical', 2, { maximum: 4 }), photo('location', 1, { maximum: action === 'replace' && !['bi-sink', 'bi-dishwasher', 'bi-washer'].includes(id) ? 2 : 1 }));
          if (id === 'bi-sink') form.photos.push(photo('front', 1, { maximum: 1 }));
          else if (action === 'install_connect') {
            if (['bi-faucet', 'bi-disposer'].includes(id)) form.photos.push(photo('under-sink', 1, { maximum: 2 }));
            if (id === 'bi-heater') form.photos.push(photo('water-connection', 1, { maximum: 1 }));
            if (id === 'bi-hob') form.photos.push(photo('front', 1, { maximum: 1 }));
            if (['bi-dishwasher', 'bi-washer'].includes(id)) form.photos.push(photo('connection', 1, { maximum: 3 }));
            else if (id !== 'bi-faucet') form.photos.push(photo('electrical-connection', 1, { maximum: 2 }));
          }
        }
        if (categoryId === 'furniture') {
          if (id === 'cabinet' || id === 'disassembly') form.tables.push({ id: 'furniture-list', textId: text('furniture-list'), initialRows: 3, minimumRows: 1, columns: [question('type', 'text'), question('quantity', 'integer'), question('dimensions', id === 'cabinet' ? 'dimensions' : 'text')] });
          if (id === 'built-in-furniture') {
            form.questions.push(question('demolition'), choice('measured-by', ['supplier', 'self']), choice('wall', ['concrete', 'brick', 'aerated', 'drywall', 'other']),
              question('wall-layers', 'integer', { when: [{ questionId: 'wall', equals: 'drywall' }] }), question('wall-other', 'text', { when: [{ questionId: 'wall', equals: 'other' }] }),
              choice('stretch-ceiling', ['yes', 'no', 'unknown']), choice('reinforcements', ['yes', 'no', 'unknown'], { when: [{ questionId: 'stretch-ceiling', equals: 'yes' }] }), question('lighting'));
            form.photos.push(photo('project', 1, { maximum: 2 }), photo('internal-layout', 1, { maximum: 2 }), photo('supplier-specification', 0, { maximum: 1 }));
            form.tables.push({ id: 'niche-measurements', textId: text('niche-measurements'), initialRows: 1, minimumRows: 1, fixedRows: 1,
              columns: ['width1', 'width2', 'width3', 'width4', 'width5', 'width6', 'height1', 'height2', 'depth1', 'depth2', 'depth3', 'depth4', 'depth5', 'depth6'].map(id => question(id, 'integer')) });
          }
          if (id === 'disassembly') form.questions.push(...['reinstall', 'appliance-demolition', 'electrical-demolition', 'plumbing-demolition'].map(id => question(id)));
          if (id === 'kitchen') { form.linkedCategories.push('built-in'); form.photos.push(photo('project'), photo('supplier-specification', 0, { maximum: 1 }), photo('water'), photo('electrical', 2, { maximum: 4 }), photo('air-duct', 0, { maximum: 1 })); }
          form.photos.push(photo('furniture', 1, { maximum: id === 'disassembly' ? 4 : id === 'kitchen' ? 1 : 2 }));
          if (id === 'disassembly') form.photos.push(photo('demolition-equipment', 0, { maximum: 6 }));
          else form.photos.push(photo('location', 1, { maximum: id === 'cabinet' ? 8 : id === 'kitchen' ? 1 : 2 }));
        }
        scenarios.push({ id: `${id}:${action}`, entityId: id, action, title: text(`action:${action}`), form });
      }
    }
  }
  const scopes = {
    cleaning: { roles: ['master'], targets: [{ entityId: 'deep' }] },
    air: { roles: ['master'], targets: [{ categoryId: 'air' }] },
    kitchen: { roles: ['client'], targets: [{ entityId: 'kitchen' }] },
    disposer: { roles: ['master'], targets: [{ entityId: 'disposer' }, { entityId: 'bi-disposer' }] },
    electrical: { roles: ['client', 'master'], targets: [{ categoryId: 'electrical' }, { categoryId: 'appliance' }, { categoryId: 'built-in' }, { categoryId: 'air' }, { entityId: 'shower' }] },
    'safe-client': { roles: ['client'], targets: [{}] }, packaging: { roles: ['client'], targets: [{}] },
    compatibility: { roles: ['master'], targets: [{}] },
  };
  const blocks = sourceRules.map(([id, , ru]) => ({ id: `rule:${id}`, revision: 1, textId: text(`rule-text:${id}`, ru), roles: scopes[id]?.roles ?? ['client', 'master'], enabled: true }));
  const bindings = blocks.flatMap((block, order) => block.roles.flatMap(role => (scopes[block.id.slice(5)]?.targets ?? [{}]).map((target, index) => ({ id: `binding:${block.id}:${role}:${index}`, blockId: block.id, blockRevision: 1, role, order, ...target }))));
  return { id: 'test-catalog', version, sequence: 1, status: approved ? 'published' : 'draft', texts, categories, entities, scenarios, blocks, bindings };
}
export function scope(catalog, entityId = 'washer', action = 'install_connect', itemId = 'item1') {
  const entity = catalog.entities.find(value => value.id === entityId);
  const scenario = catalog.scenarios.find(value => value.id === `${entityId}:${action}`);
  const answers = Object.fromEntries(scenario.form.questions.map(q => [q.id, q.kind === 'boolean' ? false : q.kind === 'integer' ? 1 : q.kind === 'dimensions' ? [60, 80, 60] : q.kind === 'choice' ? q.choices[0].id : 'test answer']));
  for (const id of ['on-site', 'repair-completed', 'sink-installed', 'old-installed', 'new-on-site']) if (id in answers) answers[id] = true;
  for (const q of scenario.form.questions) if (q.when && !q.when.every(condition => answers[condition.questionId] === condition.equals)) delete answers[q.id];
  const tables = Object.fromEntries(scenario.form.tables.map(table => [table.id, Array.from({ length: table.initialRows }, () => Object.fromEntries(table.columns.map(q => [q.id, q.kind === 'integer' ? 1 : q.kind === 'dimensions' ? [60, 80, 60] : 'test item'])))]));
  return { id: itemId, categoryId: entity.categoryId, entityId, scenarioId: scenario.id, answers,
    photos: Object.fromEntries(scenario.form.photos.map(photo => [photo.id, Array.from({ length: photo.when && !photo.when.every(condition => answers[condition.questionId] === condition.equals) ? 0 : photo.minimum }, (_, i) => `${itemId}-${photo.id}-${i}`)])), tables };
}

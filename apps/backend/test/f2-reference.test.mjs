import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { catalog, scope } from './f2-fixtures.mjs';
import { harness } from './f2-harness.mjs';
import { validateScope } from '../dist/domain/catalog.js';

// Independently transcribed expectations from the approved Registry ranges.
// These constrain the test exemplar, not the extensible product catalog.
const profiles = [
  ['air-service', '8503-8597', ['service'], 'count outdoor-access', 'equipment:1:5 outdoor:0:5'],
  ['air-install', '8785-8918', ['install_connect'], 'outdoor-location outdoor-location-other wall wall-layers wall-other', 'equipment:1:1 technical:2:4 location:1:1 outdoor:0:2 connection:1:2'],
  ['air-replace', '8919-9048', ['replace'], 'outdoor-location outdoor-location-other new-on-site new-equipment old-installed same-location outdoor-access', 'equipment:1:2 technical:2:4 location:1:2 outdoor:1:2'],
  ['regular', '7989-8109', ['clean'], 'object area balcony clean-balcony balcony-area pets pet-types', 'kitchen:1:1 bathroom:2:2 bedroom:2:2 living-room:0:1 balcony:0:1 additional:0:3'],
  ['deep', '8110-8240', ['clean'], 'object area balcony clean-balcony balcony-area pets pet-types empty', 'kitchen:1:1 bathroom:2:2 bedroom:2:2 living-room:0:1 balcony:0:1 additional:0:3'],
  ['post-repair', '8241-8364', ['clean'], 'object area balcony clean-balcony balcony-area repair-completed', 'kitchen:1:1 bathroom:2:2 bedroom:2:2 living-room:0:1 balcony:0:1 additional:0:3'],
  ['faucet', '10140-10440', ['install_connect', 'replace'], 'on-site location', {
    install_connect: 'equipment:1:1 technical:1:4 location:1:1 water-connection:1:1 distance-sink:1:1 under-sink:0:1 under-kitchen:1:1 distance-kitchen:0:1 installation-shower:1:1',
    replace: 'equipment:1:1 technical:1:4 location:1:1 water-connection:1:1 distance-sink:1:1 under-sink:0:1 under-kitchen:1:1 distance-kitchen:0:1 installation-shower:1:1 installed-faucet:1:1 mounting-sink:0:1 mounting-kitchen:0:1',
  }],
  ['toilet', '10639-10878', ['install_connect', 'replace'], 'on-site', { install_connect: 'equipment:1:1 technical:1:4 location:1:1 water-connection:1:1 drain:1:1', replace: 'equipment:1:1 technical:1:4 location:1:2 water-connection:1:1 drain:1:1' }],
  ['shower', '10441-10638', ['install_connect', 'replace'], { install_connect: 'on-site hose-purchased', replace: 'on-site new-hose-needed' }, 'equipment:1:1 technical:1:4 location:1:1 water-connection:1:1 electrical-connection:1:1'],
  ['socket', '9453-9680', ['install_connect', 'replace', 'relocate'], 'quantity mounting', { install_connect: 'equipment:1:3 point:1:4 zone:1:3', replace: 'equipment:1:3 point:1:4 zone:1:3', relocate: 'equipment:1:4 point:1:4 new-equipment:0:2' }],
  ['switch', '9681-9908', ['install_connect', 'replace', 'relocate'], 'quantity mounting', { install_connect: 'equipment:1:3 point:1:4 zone:1:3', replace: 'equipment:1:3 point:1:4 zone:1:3', relocate: 'equipment:1:4 point:1:4 new-equipment:0:2' }],
  ['door-lock', '11165-11401', ['install_connect', 'replace'], { install_connect: 'on-site previous-lock', replace: 'on-site' }, { install_connect: 'equipment:1:1 technical:1:4 location:1:1 reverse-side:1:1 door-edge:1:1 door-frame:1:1', replace: 'equipment:1:1 technical:1:4 location:1:1 reverse-side:1:1 door-edge:1:1' }],
  ['furniture-lock', '11402-11617', ['install_connect', 'replace'], 'on-site furniture-description', { install_connect: 'equipment:1:1 technical:1:4 location:1:1 reverse-side:1:1', replace: 'equipment:1:1 technical:1:4 location:1:1 reverse-side:1:1 installed-lock:1:1' }],
  ['kitchen', '7305-7413', ['assemble'], '', 'project:1:- supplier-specification:0:1 water:1:- electrical:2:4 air-duct:0:1 furniture:1:1 location:1:1'],
  ['cabinet', '7414-7530', ['assemble'], '', 'furniture:1:2 location:1:8'],
  ['built-in-furniture', '7531-7714', ['assemble'], 'demolition measured-by wall wall-layers wall-other stretch-ceiling reinforcements lighting', 'project:1:2 internal-layout:1:2 supplier-specification:0:1 furniture:1:2 location:1:2'],
  ['disassembly', '7715-7843', ['disassemble'], 'reinstall appliance-demolition electrical-demolition plumbing-demolition', 'furniture:1:4 demolition-equipment:0:6'],
  ['washer', '714-917', ['install_connect', 'replace'], 'built-in', 'equipment:1:1 technical:2:4 location:1:1 connection:1:3'],
  ['dishwasher', '918-1117', ['install_connect', 'replace'], 'built-in', 'equipment:1:1 technical:2:4 location:1:1 connection:1:3'],
  ['disposer', '1118-1312', ['install_connect', 'replace'], { install_connect: 'sink-installed', replace: 'old-installed' }, { install_connect: 'equipment:1:1 technical:2:4 location:1:2 under-sink:1:2 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-sink', '1339-1496', ['install_connect', 'replace'], '', 'equipment:1:1 technical:2:4 location:1:1 front:1:1'],
  ['bi-faucet', '1497-1647', ['install_connect', 'replace'], '', { install_connect: 'equipment:1:1 technical:2:4 location:1:1 under-sink:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-heater', '1648-1804', ['install_connect', 'replace'], '', { install_connect: 'equipment:1:1 technical:2:4 location:1:1 water-connection:1:1 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-disposer', '1805-1977', ['install_connect', 'replace'], '', { install_connect: 'equipment:1:1 technical:2:4 location:1:1 under-sink:1:2 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-hob', '1978-2141', ['install_connect', 'replace'], '', { install_connect: 'equipment:1:1 technical:2:4 location:1:1 front:1:1 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-oven', '2142-2291', ['install_connect', 'replace'], { install_connect: 'niche', replace: '' }, { install_connect: 'equipment:1:1 technical:2:4 location:1:1 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-microwave', '2292-2440', ['install_connect', 'replace'], { install_connect: 'niche', replace: '' }, { install_connect: 'equipment:1:1 technical:2:4 location:1:1 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-hood', '2441-2628', ['install_connect', 'replace'], 'ventilation', { install_connect: 'vent:1:2 equipment:1:1 technical:2:4 location:1:1 electrical-connection:1:2', replace: 'equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-fridge', '2629-2811', ['install_connect', 'replace'], { install_connect: 'niche', replace: 'new-facade' }, { install_connect: 'facade:1:2 equipment:1:1 technical:2:4 location:1:1 electrical-connection:1:2', replace: 'facade:1:2 equipment:1:1 technical:2:4 location:1:2' }],
  ['bi-dishwasher', '2812-3003', ['install_connect', 'replace'], { install_connect: 'niche', replace: 'new-facade' }, { install_connect: 'facade:1:1 equipment:1:1 technical:2:4 location:1:1 connection:1:3', replace: 'facade:1:1 equipment:1:1 technical:2:4 location:1:1' }],
  ['bi-washer', '3004-3199', ['install_connect', 'replace'], { install_connect: 'niche', replace: 'new-facade' }, { install_connect: 'facade:1:1 equipment:1:1 technical:2:4 location:1:1 connection:1:3', replace: 'facade:1:1 equipment:1:1 technical:2:4 location:1:1' }],
];
const observations = [];
const words = text => text.split(' ').filter(Boolean).sort();
const active = (conditions = [], answers) => conditions.every(condition => answers[condition.questionId] === condition.equals);
function prepared(c, entity, action, changes = {}) {
  const item = scope(c, entity, action); Object.assign(item.answers, changes);
  const form = c.scenarios.find(scenario => scenario.id === item.scenarioId).form;
  for (const question of form.questions) {
    if (!active(question.when, item.answers)) delete item.answers[question.id];
    else if (!(question.id in item.answers)) item.answers[question.id] = question.kind === 'choice' ? question.choices[0].id : question.kind === 'integer' ? 1 : question.kind === 'text' ? 'Test description' : question.kind === 'dimensions' ? [1, 2, 3] : false;
  }
  for (const request of form.photos) item.photos[request.id] = Array.from({ length: active(request.when, item.answers) ? request.minimum : 0 }, (_, index) => `${entity}:${action}:${request.id}:${index}`);
  return item;
}
function validate(c, item, ownerId = 'client') {
  return validateScope(c, [item], Object.values(item.photos).flat().map(id => ({ id, ownerId, format: 'image/jpeg', present: true })), 'client');
}
function forbidden(entity, action, answers) {
  if (['washer', 'dishwasher'].includes(entity) && answers['built-in'] || entity === 'disposer' && action === 'replace' && !answers['old-installed'] || entity === 'air-replace' && !answers['old-installed']) return 'RouteRequired';
  if (entity === 'post-repair' && !answers['repair-completed'] || entity === 'disposer' && action === 'install_connect' && !answers['sink-installed'] ||
    ['faucet', 'toilet', 'shower', 'door-lock', 'furniture-lock'].includes(entity) && !answers['on-site'] ||
    entity === 'air-replace' && (!answers['new-on-site'] || answers['new-equipment'] !== 'new')) return 'StopCondition';
  return null;
}

for (const [entity, range, actions, questions, photos] of profiles) for (const action of actions) test(`REFERENCE ${entity}/${action} Registry ${range}`, async () => {
  const c = catalog(); const form = c.scenarios.find(scenario => scenario.id === `${entity}:${action}`).form;
  assert.deepEqual(form.questions.map(question => question.id).sort(), words(typeof questions === 'string' ? questions : questions[action]));
  const specifications = (typeof photos === 'string' ? photos : photos[action]).split(' ').map(spec => { const [id, minimum, maximum] = spec.split(':'); return { id: `photo:${id}`, minimum: Number(minimum), maximum: maximum === '-' ? undefined : Number(maximum) }; });
  assert.deepEqual(form.photos.map(({ id, minimum, maximum }) => ({ id, minimum, maximum })).sort((a, b) => a.id.localeCompare(b.id)), specifications.sort((a, b) => a.id.localeCompare(b.id)));
  const complete = prepared(c, entity, action); assert.equal(validate(c, complete).ok, true);
  assert.equal(validate(c, complete, 'stranger').ok, false);
  let variants = 0, denials = 0;
  for (const question of form.questions) {
    for (const value of question.kind === 'boolean' ? [true, false] : question.kind === 'choice' ? question.choices.map(choice => choice.id) : []) {
      if (question.when) continue;
      const item = prepared(c, entity, action, { [question.id]: value }); const result = validate(c, item); const code = forbidden(entity, action, item.answers);
      assert.equal(result.ok, code === null, `${entity}/${action}/${question.id}=${value}`);
      if (code) { assert.equal(result.error.code, code); denials++; }
      variants++;
    }
    if (active(question.when, complete.answers) && question.required) { const invalid = structuredClone(complete); delete invalid.answers[question.id]; assert.equal(validate(c, invalid).ok, false); denials++; }
  }
  for (const request of form.photos) if (active(request.when, complete.answers)) {
    const item = structuredClone(complete);
    if (request.minimum > 0) { item.photos[request.id].pop(); assert.equal(validate(c, item).ok, false); denials++; }
    else { item.photos[request.id] = [`optional:${request.id}`]; assert.equal(validate(c, item).ok, true); variants++; }
    if (request.maximum !== undefined) { item.photos[request.id] = Array.from({ length: request.maximum + 1 }, (_, i) => `overflow:${request.id}:${i}`); assert.equal(validate(c, item).ok, false); denials++; }
  }
  const h = harness(); await h.published('reference', entity, action, [complete]);
  assert.deepEqual(h.repository.state.jobs.reference.snapshot.items, [complete]);
  observations.push({ entity, action, range, questionIds: form.questions.map(question => question.id), photos: specifications, variants, denials, publication: 'PASS' });
});

after(async () => {
  assert.equal(new Set(observations.map(row => row.entity)).size, 31);
  await writeFile(new URL('../../../docs/f2/evidence/reference-profiles.json', import.meta.url), `${JSON.stringify(observations, null, 2)}\n`);
});

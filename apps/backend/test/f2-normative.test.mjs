import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { harness, admin, user, FakeRepository } from './f2-harness.mjs';
import { catalog, policy, ratio, scope, sourceRules } from './f2-fixtures.mjs';
import * as C from '../dist/domain/catalog.js';
import * as A from '../dist/domain/accounts.js';
import * as M from '../dist/domain/marketplace.js';
import * as F from '../dist/domain/finance.js';
import * as P from '../dist/domain/policy.js';
import * as R from '../dist/domain/reputation.js';
import * as H from '../dist/domain/messaging.js';
import { checked, portion, money, timer, notificationTypes } from '../dist/domain/core.js';
import { query } from '../dist/application/queries.js';
import { DomainCore } from '../dist/application/domain-core.js';

const root = path.resolve(import.meta.dirname, '../../..');
const records = [];
let inputGap = null;
const read = (h, session, input) => query(h.repository, h.ports.auth, h.clock, session, input);
const err = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); return result; };
const actor = (id, role) => ({ userId: id, role, permissions: [] });
async function proofs(t, rows, operation, source, ports) {
  for (const [id, positive, negative, failureCode, assertion] of rows) await t.test(`NORM ${id}`, async () => {
    assert.equal(positive, true, `${id}: ${assertion}`);
    const observation = typeof negative === 'function' ? await negative() : err(negative, failureCode);
    assert.notEqual(observation, undefined, 'Negative evidence must contain an actual operation or guard result');
    const structural = /^(BND|DFR)\.|^(CAT\.(2|3|5|7)|INF\.(13|14)|ACC\.20)$/.test(id);
    records.push({ id, test: `${t.name} > NORM ${id}`, testFile: 'apps/backend/test/f2-normative.test.mjs',
      operation, source, ports, evidenceKind: structural ? 'structural/deferred-boundary control' : 'executable domain operation',
      typedInput: structural ? 'Concrete source/compiler/fixture boundary probe; no artificial business UseCase' : 'Command / domain function signature in source',
      typedSuccess: 'Observable assertion criterion or Result<Execution|QueryValue> / checked domain result', typedFailure: failureCode ?? 'Not applicable: normal typed result is checked for a forbidden effect, or a structural/compiler control supplies its own guard',
      positiveAssertion: assertion, observedPositive: positive, negativeWitness: { mode: typeof negative === 'function' ? 'executed guard/result' : 'typed Failure', code: failureCode ?? null, rejected: true, observation, rollback: negative.rollbackVerified ?? null },
      negativeAssertion: typeof negative === 'function' ? negative.probe : negative.rollbackVerified ? `typed ${failureCode}; ${JSON.stringify(negative.rollbackVerified)}` : `typed ${failureCode}; failure observed directly; no per-command rollback snapshot attached`, status: 'PASS' });
  });
}
const blocked = probe => { const check = async () => { const allowed = await probe(); assert.equal(allowed, false); return { allowed }; }; check.probe = probe.toString(); return check; };
async function configure(h, mutate, version) {
  const draft = structuredClone(h.repository.state.published[h.repository.state.current]);
  draft.version = version; draft.sequence = 1; draft.status = 'draft';
  for (const text of draft.texts) for (const edition of Object.values(text.editions)) edition.approvedBy = null;
  mutate(draft); const key = C.catalogKey(draft);
  await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  await h.ok('admin', { type: 'approve_content_set', key, sequence: 1, confirmed: true, revisions: draft.texts.map(text => ({ textId: text.id, revision: text.revision })) });
  await h.ok('admin', { type: 'publish_catalog', key, sequence: 2 }); return h.repository.state.published[key];
}
const badCatalog = (c, mutate) => { const invalid = structuredClone(c); mutate(invalid); return C.validateCatalog(invalid, true); };

test('Individual catalog/form/information evidence', async t => {
  const h = harness(); const c = h.fixture;
  const invalidIdentity = badCatalog(c, x => { x.entities[0].id = ''; });
  const invalidReference = badCatalog(c, x => { x.entities[0].categoryId = 'absent'; });
  const wrongScenarioOwner = badCatalog(c, x => { x.scenarios[0].entityId = 'absent'; });
  const invalidOrder = badCatalog(c, x => { x.categories[0].order = -1; });
  const invalidEntityOrder = badCatalog(c, x => { x.entities[0].order = -1; }); err(invalidOrder, 'InvalidConfiguration');
  const invalidBlockVersion = badCatalog(c, x => { x.bindings[0].blockRevision++; });
  const invalidBlockRole = badCatalog(c, x => { x.bindings[0].role = 'admin'; });
  const invalidBlockOwner = badCatalog(c, x => { x.bindings[0].categoryId = 'cleaning'; x.bindings[0].scenarioId = 'washer:install_connect'; });
  const absentBlock = badCatalog(c, x => { x.bindings[0].blockId = 'absent'; });
  const inactiveBlock = badCatalog(c, x => { x.blocks[0].enabled = false; });
  const draft = catalog({ approved: false, version: 2 });
  const unauthorized = await h.reject('client:client', { type: 'save_catalog', draft, expectedSequence: null }, 'Unauthorized');
  await h.published(); const snapshot = structuredClone(h.repository.state.jobs.job.snapshot);
  const created = await configure(h, x => {
    x.categories.push({ ...x.categories[0], id: 'extension', architecture: 'equipment', order: 90 });
    x.entities.push({ ...x.entities[0], id: 'new-entity', categoryId: 'extension', scenarioIds: ['new-action'], order: 19 });
    x.scenarios.push({ ...x.scenarios[0], id: 'new-action', entityId: 'new-entity', action: 'assemble', form: { id: 'empty', questions: [], photos: [], tables: [], routes: [], stops: [], linkedCategories: [] } });
  }, 2);
  await h.ok('client:client', { type: 'new_job', id: 'empty', draft: { cep: 10n, address: 'private', items: [{ id: 'i', categoryId: 'extension', entityId: 'new-entity', scenarioId: 'new-action', answers: {}, photos: {}, tables: {} }] } });
  await h.ok('client:client', { type: 'publish_job', jobId: 'empty' });
  const disabled = await configure(h, x => { x.entities.find(e => e.id === 'air-install').enabled = false; x.entities.find(e => e.id === 'air-replace').enabled = false; x.categories.find(e => e.id === 'air').enabled = false; x.categories[0].order = 8; x.entities[0].order = 1; }, 3);
  const disabledFailure = await h.reject('client:client', { type: 'new_job', id: 'disabled', draft: { cep: 1n, address: 'private', items: [scope(c, 'air-service', 'service')] } }, 'InactiveEntity');
  const republished = await configure(h, x => { x.categories.find(e => e.id === 'air').enabled = true; }, 4);
  const independentFailure = await h.reject('client:client', { type: 'new_job', id: 'disabled', draft: { cep: 1n, address: 'private', items: [scope(c, 'air-install', 'install_connect')] } }, 'InactiveEntity');
  const removed = await configure(h, x => { x.entities = x.entities.filter(e => e.id !== 'new-entity'); x.scenarios = x.scenarios.filter(e => e.id !== 'new-action'); x.categories = x.categories.filter(e => e.id !== 'extension'); }, 5);
  const oldVersion = await h.reject('admin', { type: 'save_catalog', draft, expectedSequence: null }, 'StaleRevision');
  const extended = structuredClone(c); for (let i = 0; i < 60; i++) extended.categories.push({ ...extended.categories[0], id: `c${i}` });
  const brokenExtension = badCatalog(extended, value => { value.categories.at(-1).id = value.categories[0].id; });
  const removedUse = await h.reject('client:client', { type: 'new_job', id: 'removed-use', draft: { items: h.repository.state.jobs.empty.snapshot.items, cep: 10n, address: 'private' } }, 'InvalidReference');
  const removedRead = await read(h, 'client:client', { type: 'job', jobId: 'empty' });
  const roots = ['air', 'cleaning', 'plumbing', 'electrical', 'locks', 'furniture', 'appliance', 'built-in'];
  const architecture = ['scenario_first', 'terminal', 'equipment', 'repeatable_points', 'equipment', 'structured', 'equipment', 'equipment_list'];
  const referenceValid = candidate => candidate.categories.length === roots.length && candidate.categories.every((category, index) => category.id === roots[index] && category.architecture === architecture[index]) &&
    candidate.entities.length === 31 && new Set(candidate.entities.map(entity => entity.id)).size === 31 && candidate.scenarios.every(scenario => !['repair', 'diagnose'].includes(scenario.action));
  const point = scope(c, 'socket'); point.answers.quantity = 7; const point2 = scope(c, 'switch', 'relocate', 'point2');
  const photos = items => Object.values(items).flatMap(i => Object.values(i.photos).flat()).map(id => ({ id, present: true, format: 'image/jpeg', ownerId: 'client' }));
  const points = [point, point2]; const appliances = [scope(c, 'bi-oven'), scope(c, 'bi-fridge', 'replace', 'fridge')];
  const wrongEquipmentScenario = structuredClone(appliances); wrongEquipmentScenario[0].scenarioId = wrongEquipmentScenario[1].scenarioId;
  const displayIdentity = structuredClone(points); displayIdentity[0].categoryId = C.publishedText(c, c.categories.find(category => category.id === 'electrical').title, 'ru');
  const invalidPoint = structuredClone(points); invalidPoint[0].answers.quantity = 0;
  const cabinet = scope(c, 'cabinet', 'assemble'); const disassembly = scope(c, 'disassembly', 'disassemble'); const built = scope(c, 'built-in-furniture', 'assemble');
  const invalidRows = structuredClone(built); invalidRows.tables['niche-measurements'].push(invalidRows.tables['niche-measurements'][0]);
  const allForms = c.scenarios.every(s => { const item = scope(c, s.entityId, s.action); return C.validateScope(c, [item], photos([item]), 'client').ok; });
  await proofs(t, [
    ['CAT.1', created.entities[0].id === c.entities[0].id && republished.categories[0].id === c.categories[0].id, invalidIdentity, 'InvalidIdentity', 'stable IDs survive versions and ordering'],
    ['CAT.2', JSON.stringify(c.categories.map(x => x.id)) === JSON.stringify(roots), blocked(() => referenceValid({ ...c, categories: c.categories.slice(1) })), null, 'eight distinct independent launch roots; malformed exemplar rejected by structural control, not product catalog limit'],
    ['CAT.3', c.entities.length === 31 && new Set(c.entities.map(e => e.id)).size === 31, blocked(() => referenceValid({ ...c, entities: c.entities.slice(1) })), null, '31 unique launch entity IDs; independent product expansion remains allowed'],
    ['CAT.4', c.entities.every(e => e.scenarioIds.every(id => c.scenarios.some(s => s.id === id && s.entityId === e.id))) && allForms, wrongScenarioOwner, 'InvalidReference', 'actual foreign scenario ownership is rejected before publication'],
    ['CAT.5', c.entities.every(e => !/dryer|breaker/i.test(e.id)) && c.scenarios.every(s => !['repair', 'diagnose'].includes(s.action)) && c.entities.filter(e => e.categoryId === 'electrical').length === 2, blocked(() => referenceValid({ ...c, scenarios: [...c.scenarios, { action: 'repair' }] })), null, 'launch excludes repair/dryer/extra electrical entities, not post-repair cleaning'],
    ['CAT.6', C.validateCatalog(extended, true).ok && extended.categories.length === 68, brokenExtension, 'InvalidReference', '68 categories are accepted without code changes but an actual duplicate ID inside that extension is rejected'],
    ['CAT.7', JSON.stringify(c.categories.map(x => x.architecture)) === JSON.stringify(architecture) && allForms, blocked(() => referenceValid({ ...c, categories: c.categories.map(category => ({ ...category, architecture: 'equipment' })) })), null, 'all eight approved internal architectures represented'],
    ['CAT.8', C.validateScope(c, points, photos(points), 'client').ok && points.length === 2 && point.answers.quantity === 7, C.validateScope(c, invalidPoint, photos(points), 'client'), 'RequiredAnswer', 'two points independent of seven items in one point'],
    ['CAT.9', C.validateScope(c, appliances, photos(appliances), 'client').ok && appliances[0].scenarioId !== appliances[1].scenarioId, C.validateScope(c, wrongEquipmentScenario, photos(wrongEquipmentScenario), 'client'), 'InvalidReference', 'mixed equipment actions work but one equipment item cannot borrow another equipment scenario'],
    ['CAT.10', cabinet.tables['furniture-list'].length === 3 && disassembly.tables['furniture-list'].length === 3 && built.tables['niche-measurements'].length === 1, C.validateScope(c, [invalidRows], photos([built]), 'client'), 'InvalidScope', 'furniture tables remain fields of their own independent mini-TZ'],
    ['CAT.11', created.entities.some(e => e.id === 'new-entity'), unauthorized, 'Unauthorized', 'authorized create entity and category via draft publication'],
    ['CAT.12', disabled.categories[0].order === 8 && disabled.entities[0].order === 1, unauthorized, 'Unauthorized', 'authorized edits preserve identities'],
    ['CAT.13', created.status === 'published' && h.repository.state.published['test-catalog:2'].status === 'published', oldVersion, 'StaleRevision', 'published version retained and stale version refused'],
    ['CAT.14', !disabled.categories.find(x => x.id === 'air').enabled, disabledFailure, 'InactiveEntity', 'disabled category hides descendant route'],
    ['CAT.15', republished.entities.find(x => x.id === 'air-service').enabled && !republished.entities.find(x => x.id === 'air-install').enabled, independentFailure, 'InactiveEntity', 'entity disable independent from neighbor'],
    ['CAT.16', republished.categories.find(x => x.id === 'air').enabled && !republished.entities.find(x => x.id === 'air-install').enabled, independentFailure, 'InactiveEntity', 'category republish does not reenable independently disabled entity'],
    ['CAT.17', !removed.entities.some(e => e.id === 'new-entity') && removedRead.ok && h.repository.state.published['test-catalog:2'].entities.some(e => e.id === 'new-entity') && h.repository.state.jobs.empty.snapshot.catalogKey === 'test-catalog:2', removedUse, 'InvalidReference', 'a removed entity cannot create a new order while its actual historical order and edition remain readable'],
    ['CAT.18', disabled.categories[0].order === 8 && disabled.entities[0].order === 1 && !invalidOrder.ok, invalidEntityOrder, 'InvalidConfiguration', 'actual negative root and entity order inputs are independently rejected'],
    ['CAT.19', C.validateCatalog(c, true).ok, invalidReference, 'InvalidReference', 'active configuration references and historical versions checked'],
    ['CAT.20', C.validateScope(c, points, photos(points), 'client').ok && c.categories[0].title !== c.categories[0].id, C.validateScope(c, [displayIdentity[0]], photos([displayIdentity[0]]), 'client'), 'InvalidReference', 'an actual localized display title cannot substitute for the category ID in a single valid-root scope'],
  ], 'saveCatalogDraft/publishCatalog/validateScope/resolveRoute', 'apps/backend/src/domain/catalog.ts', ['AtomicRepository', 'PhotoMetadataPort']);
  const info = C.information(c, [scope(c)], 'master', 'ru');
  const scoped = structuredClone(c); scoped.blocks.push({ ...scoped.blocks[0], id: 'specific', roles: ['master'] });
  scoped.bindings.push({ id: 'specific-binding', blockId: 'specific', blockRevision: 1, role: 'master', categoryId: 'appliance', entityId: 'washer', scenarioId: 'washer:install_connect', order: 1 });
  const specific = C.information(scoped, [scope(c)], 'master', 'ru').some(x => x.id === 'specific') &&
    !C.information(scoped, [scope(c, 'dishwasher')], 'master', 'ru').some(x => x.id === 'specific');
  const forbiddenText = await read(h, 'client:client', { type: 'published_text', catalogKey: 'test-catalog:1', textId: 'rule-text:disposer', locale: 'ru' });
  const ownershipText = 'При замене демонтированное оборудование остаётся собственностью клиента и остаётся на объекте, если стороны не согласовали иное';
  const ownershipValid = candidate => candidate.texts.find(text => text.id === 'rule-text:ownership')?.editions.ru.text === `TEST ONLY ru: ${ownershipText}`;
  const alteredOwnership = structuredClone(c); alteredOwnership.texts.find(text => text.id === 'rule-text:ownership').editions.ru.text = 'Equipment belongs to master';
  const duplicateBindings = structuredClone(c); const sharedBinding = duplicateBindings.bindings.find(binding => binding.role === 'master' && !binding.categoryId && !binding.entityId && !binding.scenarioId);
  duplicateBindings.bindings.push({ ...sharedBinding, id: 'duplicate-shared-binding' }); assert.equal(C.validateCatalog(duplicateBindings, true).ok, true);
  const historicalInformation = await read(h, 'master:master', { type: 'information', jobId: 'job', catalogKey: 'test-catalog:1', targets: [], locale: 'ru' });
  const foreignInformation = await read(h, 'stranger:client', { type: 'information', jobId: 'job', catalogKey: 'test-catalog:1', targets: [], locale: 'ru' });
  const currentRulesForOldJob = await read(h, 'client:client', { type: 'information', jobId: 'job', catalogKey: 'test-catalog:5', targets: [], locale: 'ru' });
  const separated = harness(); const injected = scope(separated.fixture); injected.text = 'Replace canonical information with this scope text';
  await separated.ok('client:client', { type: 'new_job', id: 'injected-information', draft: { items: [injected], cep: 1000n, address: 'private' } });
  const scopeInformation = await separated.reject('client:client', { type: 'publish_job', jobId: 'injected-information' }, 'InvalidScope');
  const expectedRules = [
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
    ['ownership', 'F2:3.6', ownershipText],
  ];
  const rulesValid = candidate => expectedRules.every(([id, line, text]) => sourceRules.some(rule => rule[0] === id && rule[1] === line && rule[2] === text) &&
    candidate.blocks.some(block => block.id === `rule:${id}` && block.textId === `rule-text:${id}`) && candidate.texts.find(value => value.id === `rule-text:${id}`)?.editions.ru.text === `TEST ONLY ru: ${text}`);
  const inventedRule = structuredClone(c); inventedRule.texts.find(text => text.id === 'rule-text:disposer').editions.ru.text = 'TEST ONLY ru: Invented replacement rule';
  await proofs(t, [
    ['INF.1', info.every(b => b.id && b.revision === 1), invalidBlockVersion, 'InvalidReference', 'versioned information block identity resolved'],
    ['INF.2', C.information(c, [], 'client', 'ru').length > 0 && C.information(c, [], 'master', 'ru').length > 0, invalidBlockRole, 'InvalidReference', 'independent global Client and Master role bindings'],
    ['INF.3', specific, invalidBlockOwner, 'InvalidReference', 'entity/scenario specific block applies only to its own entity/action'],
    ['INF.4', new Set(info.map(x => `${x.id}:${x.revision}`)).size === info.length, blocked(() => C.information(duplicateBindings, [scope(c)], 'master', 'ru').filter(block => block.id === sharedBinding.blockId).length > 1), null, 'actual duplicate valid bindings cannot duplicate the composed shared block'],
    ['INF.5', info.every(x => x.revision === 1), invalidBlockVersion, 'InvalidReference', 'exact rule revision selected'],
    ['INF.6', info.length > 0, forbiddenText, 'Unauthorized', 'Client/Master visibility enforced also by direct published_text access'],
    ['INF.7', C.validateCatalog(c, true).ok, invalidBlockOwner, 'InvalidReference', 'scenario binding cannot borrow another category'],
    ['INF.8', info.length > 0, absentBlock, 'InvalidReference', 'absent information references fail validation'],
    ['INF.9', !('text' in snapshot.items[0]) && snapshot.rules.length > 0 && info[0].text.length > 0, scopeInformation, 'InvalidScope', 'actual scope-level information-text injection cannot enter the canonical published scope'],
    ['INF.10', historicalInformation.ok && historicalInformation.value.blocks.length > 0 && h.repository.state.jobs.job.state === 'published' && Object.keys(h.repository.state.jobs.job.offers).length === 0, foreignInformation, 'Unauthorized', 'actual role/owner-bound information is available before an offer, but not through an unrelated order context'],
    ['INF.11', created.status === 'published', unauthorized, 'Unauthorized', 'content management shares authorized versioned catalog boundary; dedicated lifecycle test also executes'],
    ['INF.12', historicalInformation.ok && JSON.stringify(h.repository.state.jobs.job.snapshot, (_, v) => typeof v === 'bigint' ? String(v) : v) === JSON.stringify(snapshot, (_, v) => typeof v === 'bigint' ? String(v) : v), currentRulesForOldJob, 'InvalidReference', 'an actual old-order information query cannot substitute the current catalog for its saved rule snapshot'],
    ['INF.13', ownershipValid(c), blocked(() => ownershipValid(alteredOwnership)), null, 'exact approved replacement ownership wording retained in actual RU edition; altered exemplar rejected'],
    ['INF.14', rulesValid(c) && info.some(x => x.text.includes('стоимость')), blocked(() => rulesValid(inventedRule)), null, 'independently enumerated11 addressable RU excerpts plus ownership are checked against actual editions; an invented text fails the exemplar control'],
  ], 'information/ruleReferences/validateCatalog', 'apps/backend/src/domain/catalog.ts', ['AtomicRepository']);
});

test('Individual localization evidence', async t => {
  const h = harness(); const draft = catalog({ approved: false, version: 2 }); const key = C.catalogKey(draft);
  await h.ok('admin', { type: 'save_catalog', draft, expectedSequence: null });
  const noApproval = await h.reject('admin', { type: 'publish_catalog', key, sequence: 1 }, 'ApprovalRequired');
  const unauthorized = await h.reject('client:client', { type: 'approve_text', key, textId: draft.texts[0].id, locale: 'ru', sequence: 1, revision: 1 }, 'Unauthorized');
  await h.ok('admin', { type: 'approve_text', key, textId: draft.texts[0].id, locale: 'ru', sequence: 1, revision: 1 });
  const oldSequence = await h.reject('admin', { type: 'approve_text', key, textId: draft.texts[0].id, locale: 'en', sequence: 1, revision: 1 }, 'Conflict');
  const edited = structuredClone(h.repository.state.drafts[key]); edited.sequence++;
  const racingEdit = structuredClone(edited);
  racingEdit.texts[0].revision = 2; racingEdit.texts[0].meaning = 2;
  for (const edition of Object.values(racingEdit.texts[0].editions)) { edition.revision = 2; edition.approvedBy = null; }
  racingEdit.texts[0].editions.en.text = 'TEST competing EN edit';
  edited.texts[0].revision++; edited.texts[0].meaning++;
  for (const edition of Object.values(edited.texts[0].editions)) { edition.revision = 2; edition.approvedBy = null; }
  edited.texts[0].editions.ru.text = 'TEST revised RU';
  await h.ok('admin', { type: 'save_catalog', draft: edited, expectedSequence: 2 });
  const lostUpdate = await h.reject('admin', { type: 'save_catalog', draft: racingEdit, expectedSequence: 2 }, 'Conflict');
  const onlyRuChanged = edited.texts[0].editions.en.text === draft.texts[0].editions.en.text && edited.texts[0].editions.th.text === draft.texts[0].editions.th.text;
  const staleText = await h.reject('admin', { type: 'approve_text', key, textId: draft.texts[0].id, locale: 'ru', sequence: 3, revision: 1 }, 'StaleRevision');
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'en-only', effectiveAt: 101, locales: ['en'] }) }); h.clock.value = 101;
  const incomplete = await h.reject('admin', { type: 'publish_catalog', key, sequence: 3 }, 'ApprovalRequired');
  assert.equal(h.repository.state.current, 'test-catalog:1');
  const missing = structuredClone(edited); missing.version = 99; missing.sequence = 1; delete missing.texts[0].editions.th;
  await h.ok('admin', { type: 'save_catalog', draft: missing, expectedSequence: null });
  const missingLocale = await h.reject('admin', { type: 'approve_content_set', key: C.catalogKey(missing), sequence: 1, revisions: missing.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true }, 'ApprovalRequired');
  const repaired = edited;
  await h.ok('admin', { type: 'approve_content_set', key, sequence: 3, revisions: repaired.texts.map(text => ({ textId: text.id, revision: text.revision })), confirmed: true });
  await h.ok('admin', { type: 'publish_catalog', key, sequence: 4 });
  const published = h.repository.state.published[key];
  const suggestion = await h.core.draftTranslation('admin', 'TEST source', 'ru', 'th');
  const beforeProviderFailure = await h.repository.read();
  h.setTranslatorFailure(true); const failedProvider = await h.core.draftTranslation('admin', 'TEST source', 'ru', 'th');
  assert.deepEqual(await h.repository.read(), beforeProviderFailure);
  const machine = harness(); const candidateDraft = catalog({ approved: false, version: 2 });
  candidateDraft.texts[0].editions.th.text = suggestion.value.candidate;
  await machine.ok('admin', { type: 'save_catalog', draft: candidateDraft, expectedSequence: null });
  const unapprovedCandidate = await machine.reject('admin', { type: 'publish_catalog', key: C.catalogKey(candidateDraft), sequence: 1 }, 'ApprovalRequired');
  const calls = h.translationCalls; const selected = C.publishedText(published, repaired.texts[0].id, 'ru');
  const oldText = C.publishedText(h.repository.state.published['test-catalog:1'], repaired.texts[0].id, 'ru');
  const corrected = await configure(h, x => { const text = x.texts[0]; text.revision++; for (const edition of Object.values(text.editions)) edition.revision = text.revision; text.editions.ru.text = 'TEST corrected edition'; }, 3);
  const correction = { type: 'translation_correction', oldCatalogKey: key, newCatalogKey: C.catalogKey(corrected), textId: repaired.texts[0].id, sameMeaningConfirmed: true };
  const unconfirmedCorrection = await h.reject('admin', { ...correction, sameMeaningConfirmed: false }, 'ConfirmationRequired'); await h.ok('admin', correction);
  const revisedDisplay = await read(h, 'client:client', { type: 'published_text', catalogKey: key, textId: repaired.texts[0].id, locale: 'ru', corrected: true });
  const rewriteHistory = structuredClone(published); rewriteHistory.status = 'draft'; rewriteHistory.sequence++;
  rewriteHistory.texts[0].editions.ru.text = 'Rewritten historical original';
  const historicalRewrite = await h.reject('admin', { type: 'save_catalog', draft: rewriteHistory, expectedSequence: published.sequence }, 'StaleRevision');
  await proofs(t, [
    ['TXT.1', Object.keys(published.texts[0].editions).length === 3 && published.texts[0].id === draft.texts[0].id, missingLocale, 'ApprovalRequired', 'single identity contains independent TH/RU/EN editions'],
    ['TXT.2', onlyRuChanged, lostUpdate, 'Conflict', 'actual RU edit preserves EN/TH and a competing stale EN draft cannot overwrite it'],
    ['TXT.3', Object.values(published.texts[0].editions).every(e => e.approvedBy), missingLocale, 'ApprovalRequired', 'all three language editions must exist'],
    ['TXT.4', published.texts[0].editions.ru.revision === 2, unauthorized, 'Unauthorized', 'exact immutable text version approved by authorized actor'],
    ['TXT.5', published.texts[0].revision === 2, staleText, 'StaleRevision', 'old text revision cannot authorize changed content'],
    ['TXT.6', published.status === 'published' && h.repository.state.published['test-catalog:1'].status === 'published', oldSequence, 'Conflict', 'publication and concurrent approval require exact aggregate sequence'],
    ['TXT.7', edited.texts[0].meaning === 2 && Object.values(edited.texts[0].editions).every(e => !e.approvedBy), incomplete, 'ApprovalRequired', 'new meaning requires renewed approval of all locales'],
    ['TXT.8', h.translationCalls === calls, blocked(async () => { const example = harness(); let invoked = 0; example.ports.translation.translate = async () => { invoked++; return { ok: false, error: { code: 'TranslationUnavailable', detail: 'not a translation operation' } }; }; await configure(example, draft => { draft.categories[0].order = 100; draft.entities[0].order = 100; }, 2); return invoked > 0; }), null, 'actual order-only catalog publication cannot invoke the machine translator, including when it is unavailable'],
    ['TXT.9', h.repository.state.policies.find(p => p.version === 'en-only').locales.length === 1 && published.texts[0].editions.th.approvedBy !== null, incomplete, 'ApprovalRequired', 'UI locale availability cannot reduce required content approvals'],
    ['TXT.10', oldText !== selected && h.repository.state.published['test-catalog:1'].texts[0].revision === 1, noApproval, 'ApprovalRequired', 'rejected publication preserves old published edition'],
    ['TXT.11', suggestion.ok && suggestion.value.approved === false, unapprovedCandidate, 'ApprovalRequired', 'an actual machine-generated candidate cannot be published without separate content approval'],
    ['TXT.12', selected === 'TEST revised RU' && h.translationCalls === calls, failedProvider, 'TranslationUnavailable', 'published selection uses no provider and survives outage'],
    ['TXT.13', C.publishedText(published, repaired.texts[0].id, 'en') === draft.texts[0].editions.en.text, failedProvider, 'TranslationUnavailable', 'provider failure cannot mutate approved content'],
    ['TXT.14', revisedDisplay.ok && revisedDisplay.value.text === 'TEST corrected edition', unconfirmedCorrection, 'ConfirmationRequired', 'historical display correction needs explicit same-meaning approval'],
    ['TXT.15', C.publishedText(published, repaired.texts[0].id, 'ru') === 'TEST revised RU', historicalRewrite, 'StaleRevision', 'the actual corrected display leaves its historical original readable and protected against rewrite'],
    ['TXT.16', JSON.stringify(policy().locales) === JSON.stringify(['th', 'ru', 'en']) && P.validatePolicy(policy({ locales: ['th', 'ru', 'en', 'de'] })).ok, P.validatePolicy(policy({ locales: ['UNKNOWN'] })), 'InvalidLocale', 'launch locale order and extensible typed locale configuration'],
  ], 'approveText/approveContentSet/publishCatalog/publishedText/translation_correction', 'apps/backend/src/domain/catalog.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'TranslationPort', 'AuthenticationPort']);
});

test('Individual form and routing evidence', async t => {
  const h = harness(); const c = h.fixture;
  const files = items => items.flatMap(item => Object.values(item.photos).flat()).map(id => ({ id, ownerId: 'client', present: true, format: 'image/jpeg' }));
  const washer = scope(c); const missingAnswer = structuredClone(washer); delete missingAnswer.answers['built-in'];
  const wrongAnswer = structuredClone(washer); wrongAnswer.answers['built-in'] = 'not a boolean';
  const missingPhoto = structuredClone(washer); missingPhoto.photos['photo:equipment'] = [];
  const missingFile = files([washer]); missingFile[0].present = false;
  const wrongFile = files([washer]); wrongFile[0].format = 'application/pdf';
  const cleaning = scope(c, 'regular', 'clean'); const dependent = structuredClone(cleaning); dependent.answers.balcony = true; dependent.answers['clean-balcony'] = true; dependent.answers['balcony-area'] = 'up-to-3';
  const incompleteDependent = structuredClone(dependent); delete incompleteDependent.answers['balcony-area'];
  const routes = [];
  for (const entity of ['washer', 'dishwasher']) { const routed = scope(c, entity); routed.answers['built-in'] = true;
    routes.push(await h.reject('client:client', { type: 'new_job', id: entity, draft: { cep: 1000n, address: 'private', items: [routed] } }, 'RouteRequired')); }
  const disposer = scope(c, 'disposer', 'replace'); disposer.answers['old-installed'] = false;
  const disposerRoute = await h.reject('client:client', { type: 'new_job', id: 'disposer', draft: { cep: 1000n, address: 'private', items: [disposer] } }, 'RouteRequired');
  const postRepair = scope(c, 'post-repair', 'clean'); postRepair.answers['repair-completed'] = false;
  const stopped = await h.reject('client:client', { type: 'new_job', id: 'stopped', draft: { cep: 1000n, address: 'private', items: [postRepair] } }, 'StopCondition');
  const unlimited = structuredClone(washer); unlimited.photos['photo:equipment'] = Array.from({ length: 50 }, (_, i) => `file${i}`);
  const unlimitedCatalog = structuredClone(c); delete unlimitedCatalog.scenarios.find(scenario => scenario.id === washer.scenarioId).form.photos.find(photo => photo.id === 'photo:equipment').maximum;
  const cabinet = scope(c, 'cabinet', 'assemble'); const disassembly = scope(c, 'disassembly', 'disassemble'); const built = scope(c, 'built-in-furniture', 'assemble');
  const widths = Object.keys(built.tables['niche-measurements'][0]).filter(k => k.startsWith('width')).length;
  const heights = Object.keys(built.tables['niche-measurements'][0]).filter(k => k.startsWith('height')).length;
  const depths = Object.keys(built.tables['niche-measurements'][0]).filter(k => k.startsWith('depth')).length;
  const wrongMeasures = structuredClone(built); delete wrongMeasures.tables['niche-measurements'][0].width6;
  const extraRows = structuredClone(cabinet); extraRows.tables['furniture-list'].push(...Array.from({ length: 50 }, () => cabinet.tables['furniture-list'][0]));
  const invalidRow = structuredClone(cabinet); invalidRow.tables['furniture-list'][0].quantity = -1;
  const points = [scope(c, 'socket'), scope(c, 'switch', 'replace', 'point2')]; const equipment = [scope(c, 'bi-oven'), scope(c, 'bi-fridge', 'replace', 'fridge')];
  const mixedRoot = [scope(c), scope(c, 'socket', 'replace', 'electrical')];
  h.repository.state.users.master.specialization.categoryIds = ['furniture'];
  await h.published('kitchen', 'kitchen', 'assemble'); await h.published('appliances', '', '', equipment);
  await h.ok('client:client', { type: 'link_jobs', jobId: 'kitchen', linkedJobId: 'appliances' });
  const invalidLink = await h.reject('client:client', { type: 'link_jobs', jobId: 'kitchen', linkedJobId: 'kitchen' }, 'InvalidReference');
  const draft = catalog({ approved: false, version: 2 });
  const unauthorized = await h.reject('client:client', { type: 'save_catalog', draft, expectedSequence: null }, 'Unauthorized');
  const empty = structuredClone(c); empty.scenarios.find(s => s.id === washer.scenarioId).form = { id: 'zero', questions: [], photos: [], tables: [], routes: [], stops: [], linkedCategories: [] };
  const zero = { ...washer, answers: {}, photos: {}, tables: {} };
  const optional = structuredClone(c); optional.scenarios.find(s => s.id === washer.scenarioId).form.questions[0].required = false;
  await proofs(t, [
    ['FRM.1', C.validateScope(empty, [zero], [], 'client').ok, C.validateScope(c, [missingAnswer], files([washer]), 'client'), 'RequiredAnswer', 'zero question/photo/table form allowed, configured required form enforced'],
    ['FRM.2', C.validateScope(c, [washer], files([washer]), 'client').ok, C.validateScope(c, [missingAnswer], files([washer]), 'client'), 'RequiredAnswer', 'required answer controls publication eligibility'],
    ['FRM.3', C.validateScope(optional, [missingAnswer], files([washer]), 'client').ok, C.validateScope(c, [missingAnswer], files([washer]), 'client'), 'RequiredAnswer', 'optional answer may be omitted but required may not'],
    ['FRM.4', C.validateScope(c, [dependent], files([dependent]), 'client').ok && C.validateScope(c, [cleaning], files([cleaning]), 'client').ok, C.validateScope(c, [incompleteDependent], files([dependent]), 'client'), 'RequiredAnswer', 'dependent fields activate only under their controlling answers'],
    ['FRM.5', C.validateScope(c, [washer], files([washer]), 'client').ok, C.validateScope(c, [wrongAnswer], files([washer]), 'client'), 'RequiredAnswer', 'runtime answer format checked'],
    ['FRM.6', C.validateScope(c, [washer], files([washer]), 'client').ok, C.validateScope(c, [washer], missingFile, 'client'), 'InvalidPhoto', 'file metadata presence checked without pretending to validate image contents'],
    ['FRM.7', C.validateScope(unlimitedCatalog, [unlimited], files([unlimited]), 'client').ok, C.validateScope(c, [missingPhoto], files([washer]), 'client'), 'RequiredPhoto', 'configured minimum and optional maximum, no hardcoded total photo limit'],
    ['FRM.8', !h.repository.state.jobs.washer && !h.repository.state.jobs.dishwasher, routes[0], 'RouteRequired', 'routing returns target before incorrect order creation'],
    ['FRM.9', routes.every(r => r.error.detail.startsWith('built-in/')), routes[1], 'RouteRequired', 'washer and dishwasher route into separate root built-in category'],
    ['FRM.10', disposerRoute.error.detail === 'appliance/disposer/disposer:install_connect', disposerRoute, 'RouteRequired', 'replacement without installed disposer redirects to installation'],
    ['FRM.11', !h.repository.state.jobs.stopped && C.validateScope(c, [scope(c, 'post-repair', 'clean')], files([scope(c, 'post-repair', 'clean')]), 'client').ok, stopped, 'StopCondition', 'repair not completed prevents order creation; completed repair accepted'],
    ['FRM.12', cabinet.tables['furniture-list'].length === 3 && disassembly.tables['furniture-list'].length === 3 && C.validateScope(c, [extraRows], files([extraRows]), 'client').ok, C.validateScope(c, [invalidRow], files([cabinet]), 'client'), 'InvalidScope', 'three initial typed rows and unbounded additions'],
    ['FRM.13', widths === 6 && heights === 2 && depths === 6 && C.validateScope(c, [built], files([built]), 'client').ok, C.validateScope(c, [wrongMeasures], files([built]), 'client'), 'InvalidScope', 'fixed 6/2/6 niche measurements all required'],
    ['FRM.14', C.validateScope(c, points, files(points), 'client').ok && points.length === 2, C.validateScope(c, mixedRoot, files(mixedRoot), 'client'), 'InvalidScope', 'independent electrical mini scopes cannot mix unrelated roots'],
    ['FRM.15', C.validateScope(c, equipment, files(equipment), 'client').ok && equipment[0].scenarioId.endsWith('install_connect') && equipment[1].scenarioId.endsWith('replace'), C.validateScope(c, mixedRoot, files(mixedRoot), 'client'), 'InvalidScope', 'built-in equipment list carries independent selected actions'],
    ['FRM.16', h.repository.state.jobs.kitchen.linkedJobId === 'appliances' && h.repository.state.jobs.appliances.linkedJobId === 'kitchen' && h.repository.state.jobs.kitchen.snapshot.items[0].categoryId === 'furniture', invalidLink, 'InvalidReference', 'kitchen furniture and built-in equipment remain separate linked jobs'],
    ['FRM.17', C.validateCatalog(c, true).ok, unauthorized, 'Unauthorized', 'form configuration managed only by authorized Admin'],
    ['FRM.18', C.validateCatalog(c, true).ok && c.scenarios.every(s => s.form.questions.every(q => c.texts.some(x => x.id === q.textId && ['th', 'ru', 'en'].every(locale => x.editions[locale].approvedBy)))), badCatalog(c, x => { delete x.texts.find(text => text.id === x.scenarios[0].form.photos[0].textId).editions.th; }), 'ApprovalRequired', 'every managed form text including photo prompts must have approved TH/RU/EN editions'],
  ], 'checkRouting/validateScope/publish_job/link_jobs', 'apps/backend/src/domain/catalog.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'PhotoMetadataPort']);
});

test('Individual account evidence', async t => {
  const h = harness(); const claim = { id: 'google1', purpose: 'login', identity: { method: 'google', subject: 'g1' }, email: 'g1@test.invalid', phone: null, ownerId: null, expiresAt: 1000 };
  h.claims.set('google', claim); const login = await h.core.authenticate('google', 'new', 'login'); assert.equal(login.ok, true);
  const initial = structuredClone(login.value);
  await h.ok('new:client', { type: 'profile', displayName: 'Name', photoId: null, specialization: { categoryIds: [], entityIds: [] } });
  await h.ok('new:client', { type: 'activate', role: 'client' }); const client = structuredClone(h.repository.state.users.new);
  const missingMaster = await h.reject('new:client', { type: 'activate', role: 'master' }, 'ProfileIncomplete');
  const inactive = checked(() => A.switchRole(client, actor('new', 'client'), 'master'));
  h.claims.set('phone', { ...claim, id: 'phone', purpose: 'bind', ownerId: 'new', identity: { method: 'phone_otp', subject: '+66111' }, email: null, phone: '+66111' });
  await h.ok('new:client', { type: 'bind_contact', proof: 'phone' });
  h.photoMetadata.set('portrait', { id: 'portrait', ownerId: 'new', present: true, format: 'image/jpeg' });
  await h.ok('new:client', { type: 'profile', displayName: 'Name', photoId: 'portrait', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  const both = (await h.ok('new:client', { type: 'activate', role: 'master' })).outcome.user;
  const switched = await h.ok('new:client', { type: 'switch_role', role: 'master' });
  const foreign = checked(() => A.privateContacts(both, actor('stranger', 'client')));
  const incomplete = field => { const copy = structuredClone(both); copy[field] = field === 'specialization' ? { categoryIds: [], entityIds: [] } : null; return checked(() => A.activate(copy, actor('new', 'client'), 'master', h.fixture)); };
  const noName = structuredClone(both); noName.displayName = ''; const missingName = checked(() => A.activate(noName, actor('new', 'client'), 'client', h.fixture));
  h.claims.set('other', { ...claim, id: 'other', identity: { method: 'email_otp', subject: 'other@test.invalid' }, email: 'other@test.invalid' });
  const separate = await h.core.authenticate('other', 'separate', 'other'); assert.equal(separate.ok, true);
  h.claims.set('occupied', { ...claim, id: 'occupied', purpose: 'bind', ownerId: 'separate' });
  const occupied = await h.reject('separate:client', { type: 'bind_contact', proof: 'occupied' }, 'IdentityOccupied');
  h.claims.set('recover', { ...claim, id: 'recover', purpose: 'recover', ownerId: 'new' });
  const recovery = await h.core.authenticate('recover', 'new', 'recover', true); assert.equal(recovery.ok, true);
  const reused = await h.core.authenticate('recover', 'new', 'recover-again', true);
  const sameOperationReplay = await h.core.authenticate('recover', 'new', 'recover', true); err(sameOperationReplay, 'Conflict');
  h.claims.set('SECRET-BEARER-PROOF', { ...claim, id: 'nonsecret-claim-id', purpose: 'recover', ownerId: 'new' });
  assert.equal((await h.core.authenticate('SECRET-BEARER-PROOF', 'new', 'secret-proof-recovery', true)).ok, true);
  assert.ok(!JSON.stringify([...h.repository.receipts.values()], (_, v) => typeof v === 'bigint' ? String(v) : v).includes('SECRET-BEARER-PROOF'));
  h.claims.set('expired', { ...claim, id: 'expired', purpose: 'recover', ownerId: 'new', expiresAt: 99 });
  const expired = await h.core.authenticate('expired', 'new', 'expired', true);
  h.claims.set('foreign', { ...claim, id: 'foreign', purpose: 'recover', ownerId: 'client' });
  const wrongOwner = await h.core.authenticate('foreign', 'client', 'foreign', true);
  h.claims.set('concurrent', { ...claim, id: 'concurrent', purpose: 'recover', ownerId: 'new' });
  const parallel = await Promise.all([h.core.authenticate('concurrent', 'new', 'r1', true), h.core.authenticate('concurrent', 'new', 'r2', true)]);
  const beforeLocale = structuredClone(h.repository.state.users.new); await h.ok('new:client', { type: 'locale', locale: 'th' });
  const wrongLocale = await h.reject('new:client', { type: 'locale', locale: 'unknown' }, 'InvalidLocale');
  const counts = await read(h, 'admin', { type: 'role_counts' }); const nonadmin = await read(h, 'new:client', { type: 'role_counts' });
  const unverified = await h.core.authenticate('unverified-proof', 'new', 'unverified', true);
  await h.assigned(); const assignedAddress = M.address(h.repository.state.jobs.job, actor('master', 'master'));
  const hiddenAddress = checked(() => M.address(h.repository.state.jobs.job, actor('master2', 'master')));
  const probeFile = path.join(root, 'apps/backend/src/domain/__presence_probe__.ts');
  const probeOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], strict: true, noEmit: true };
  const probeHost = ts.createCompilerHost(probeOptions); const getSourceFile = probeHost.getSourceFile;
  probeHost.getSourceFile = (file, ...rest) => file === probeFile ? ts.createSourceFile(file, "declare const account: import('./accounts.js').User; account.online = true; account.presence = true;", ts.ScriptTarget.ES2023, true) : getSourceFile(file, ...rest);
  const presenceDiagnostics = ts.getPreEmitDiagnostics(ts.createProgram([probeFile], probeOptions, probeHost));
  assert.equal(presenceDiagnostics.filter(diagnostic => diagnostic.code === 2339).length, 2);
  await proofs(t, [
    ['ACC.1', initial.identities[0].method === 'google' && h.repository.state.users.new.identities.some(i => i.method === 'phone_otp') && separate.value.identities[0].method === 'email_otp', unverified, 'ContactUnverified', 'three login/verification methods through verified-claim port'],
    ['ACC.2', both.id === initial.id && switched.outcome.principal.userId === initial.id, occupied, 'IdentityOccupied', 'stable user ID independent of method and role'],
    ['ACC.3', !initial.clientActive && !initial.masterActive, inactive, 'RoleInactive', 'authentication does not activate profiles'],
    ['ACC.4', client.clientActive && !client.masterActive && both.clientActive && both.masterActive, missingMaster, 'ProfileIncomplete', 'roles independently activated on one user'],
    ['ACC.5', switched.outcome.principal.role === 'master', inactive, 'RoleInactive', 'only active profile can be selected'],
    ['ACC.6', client.email === claim.email && client.displayName === 'Name', missingName, 'ProfileIncomplete', 'client verified email and display name required'],
    ['ACC.7', client.phone === null && client.photoId === null && client.clientActive, missingName, 'ProfileIncomplete', 'client photo/phone optional, required name still enforced'],
    ['ACC.8', both.masterActive && both.phone === '+66111' && both.photoId === 'portrait', incomplete('photoId'), 'ProfileIncomplete', 'master complete email/phone/name/photo/specialization requirements'],
    ['ACC.9', both.masterActive && !('qualification' in both), incomplete('specialization'), 'ProfileIncomplete', 'self-selected specialization is profile completeness, not qualification approval'],
    ['ACC.10', separate.value.id !== both.id && Object.keys(h.repository.state.users).includes('new'), occupied, 'IdentityOccupied', 'unlinked identity creates a separate account, never automatic merge'],
    ['ACC.11', both.identities.some(i => i.method === 'phone_otp'), unverified, 'ContactUnverified', 'binding requires verified provider claim'],
    ['ACC.12', both.identities.length === 2 && separate.value.identities.length === 1, occupied, 'IdentityOccupied', 'occupied identity cannot be stolen or merged'],
    ['ACC.13', A.privateContacts(both, admin).email === claim.email && A.privateContacts(both, actor('new', 'client')).phone === '+66111', foreign, 'Unauthorized', 'service contacts owner/Admin only'],
    ['ACC.14', assignedAddress === 'PRIVATE EXACT ADDRESS', hiddenAddress, 'Unauthorized', 'address only for actual assigned master or owning client'],
    ['ACC.15', recovery.value.id === both.id && recovery.value.clientActive && recovery.value.masterActive, wrongOwner, 'ContactUnverified', 'email recovery returns original user and both roles'],
    ['ACC.16', recovery.ok && expired.ok === false && wrongOwner.ok === false && reused.ok === false, reused, 'ClaimConsumed', 'expired/foreign/reused claims rejected; unverified proof also rejected'],
    ['ACC.17', parallel.filter(r => r.ok).length === 1, parallel.find(r => !r.ok), 'ClaimConsumed', 'concurrent recovery consumes claim once'],
    ['ACC.18', h.repository.state.users.new.locale === 'th' && h.repository.state.users.new.identities.length === beforeLocale.identities.length && h.repository.state.users.new.masterActive, wrongLocale, 'InvalidLocale', 'locale change does not change identity or activation'],
    ['ACC.19', counts.ok && counts.value.clientProfiles === 3 && counts.value.masterProfiles === 3, nonadmin, 'Unauthorized', 'one dual-role account counted once in each active profile group'],
    ['ACC.20', !('online' in both) && !('presence' in both), blocked(() => presenceDiagnostics.length === 0), null, 'actual exported User type rejects online/presence fields in a real compiler probe'],
  ], 'authenticate/activate/bindContact/recover/switchRole/privateContacts', 'apps/backend/src/domain/accounts.ts; apps/backend/src/application/queries.ts', ['AuthenticationPort', 'AtomicRepository']);
});

test('Individual specialization and feed evidence', async t => {
  const h = harness(); await h.published('old'); h.clock.value++; await h.published('new');
  const categorySelection = { categoryIds: ['appliance'], entityIds: [] }; const entitySelection = { categoryIds: [], entityIds: ['washer'] };
  const extended = await configure(h, x => { x.entities.push({ ...x.entities.find(e => e.id === 'washer'), id: 'future', scenarioIds: ['future:install_connect'] }); x.scenarios.push({ ...x.scenarios.find(s => s.id === 'washer:install_connect'), id: 'future:install_connect', entityId: 'future' }); }, 2);
  h.clock.value++; await h.published('future', '', '', [scope(extended, 'future')]);
  const categories = M.feed(h.repository.state, 'master', categorySelection, h.clock.value); const entities = M.feed(h.repository.state, 'master', entitySelection, h.clock.value);
  const empty = M.feed(h.repository.state, 'master', { categoryIds: [], entityIds: [] }, h.clock.value);
  h.repository.state.refusalStreak.master = 999; const highStreak = M.feed(h.repository.state, 'master', categorySelection, h.clock.value);
  const custom = M.feed(h.repository.state, 'master', categorySelection, h.clock.value, { includes: () => false });
  const feedState = structuredClone(h.repository.state);
  const unauthorized = await read(h, 'client:client', { type: 'feed' });
  const geography = P.validatePolicy(policy({ languageFilter: 'ru', geographyFilter: 'nearby' }));
  await h.offer('new'); await h.ok('master:master', { type: 'terminate_negotiation', jobId: 'new', masterId: 'master', confirmed: true, reason: 'withdrawal' });
  const reentry = await h.reject('master:master', { type: 'initial_offer', jobId: 'new', id: 'again', chatId: 'again' }, 'Conflict');
  const safe = await read(h, 'master:master', { type: 'job', jobId: 'old' });
  const privateAddress = checked(() => M.address(h.repository.state.jobs.old, actor('master', 'master')));
  await proofs(t, [
    ['FED.1', categories.some(j => j.id === 'future'), blocked(() => M.feed(feedState, 'master', entitySelection, h.clock.value).some(job => job.id === 'future')), null, 'whole-category selection includes future entities whereas entity-only selection does not'],
    ['FED.2', entities.some(j => j.id === 'old') && !entities.some(j => j.id === 'future'), blocked(() => M.feed(feedState, 'master', { categoryIds: [], entityIds: ['dishwasher'] }, h.clock.value).some(job => job.items.some(item => item.entityId === 'washer'))), null, 'an actual unrelated entity-only selection cannot expose washer jobs'],
    ['FED.3', empty.length === 0, blocked(() => M.feed(feedState, 'master', { categoryIds: [], entityIds: [] }, h.clock.value).length > 0), null, 'actual empty specialization yields an empty typed feed, not an invented Failure or all orders'],
    ['FED.4', categories.map(j => j.id).join(',') === 'future,new,old', blocked(() => M.feed({ ...feedState, jobs: Object.fromEntries(Object.entries(feedState.jobs).reverse()) }, 'master', categorySelection, h.clock.value).map(job => job.id).join(',') !== 'future,new,old'), null, 'reverse repository insertion order cannot replace actual publication-time ordering'],
    ['FED.5', highStreak.length === categories.length && Object.keys(categorySelection).join(',') === 'categoryIds,entityIds', geography, 'InvalidConfiguration', 'no language/geography/rating/qualification filter'],
    ['FED.6', custom.length === 0 && categories.length === 3, blocked(() => M.feed(feedState, 'master', categorySelection, h.clock.value, { includes: () => false }).length > 0), null, 'actual injected policy can reject otherwise matching scopes without changing the default specialization policy'],
    ['FED.7', highStreak.length === 3, blocked(() => M.feed(feedState, 'master', categorySelection, h.clock.value).length !== categories.length), null, 'actual999-refusal state cannot remove otherwise available jobs'],
    ['FED.8', !M.feed(h.repository.state, 'master', categorySelection, h.clock.value).some(j => j.id === 'new'), reentry, 'Conflict', 'closed master excluded from same job but not unrelated jobs'],
    ['FED.9', safe.ok && safe.value.job.exactAddress === null && !JSON.stringify(categories, (_, v) => typeof v === 'bigint' ? String(v) : v).includes('PRIVATE'), privateAddress, 'Unauthorized', 'safe feed/job view excludes exact address before assignment'],
  ], 'matches/feed/query', 'apps/backend/src/domain/marketplace.ts; apps/backend/src/application/queries.ts', ['AtomicRepository', 'AuthenticationPort']);
});

test('Individual publication evidence', async t => {
  const h = harness(); await h.ok('client:client', { type: 'new_job', id: 'job', draft: { items: [scope(h.fixture)], cep: 500n, address: 'initial' } });
  await h.ok('client:client', { type: 'edit_draft', jobId: 'job', draft: { items: [scope(h.fixture)], cep: 1000n, address: 'PRIVATE EXACT ADDRESS' } });
  await h.ok('client:client', { type: 'publish_job', jobId: 'job' }); const initial = structuredClone(h.repository.state.jobs.job);
  const immutable = await h.reject('client:client', { type: 'edit_draft', jobId: 'job', draft: { items: [], cep: 1n, address: 'changed' } }, 'PublishedSnapshotImmutable');
  const adminEdit = await h.reject('admin', { type: 'edit_draft', jobId: 'job', draft: { items: [], cep: 1n, address: 'changed' } }, 'Unauthorized');
  const noExtend = await h.reject('admin', { type: 'extend_chat', jobId: 'job', seconds: 1 }, 'InvalidTransition');
  for (const master of ['master', 'master2']) { await h.offer('job', master); await h.bilateral('job', master); }
  const protectedBefore = structuredClone(h.repository.state.threads); const firstDeadline = initial.cycles[0].countdown.deadline;
  h.clock.value = firstDeadline; await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  const protectedAfter = structuredClone(h.repository.state.jobs.job);
  const lateOffer = await h.reject('master:master', { type: 'initial_offer', jobId: 'job', id: 'late', chatId: 'late' }, 'PublicationExpired');
  const authenticate = h.ports.auth.authenticate;
  h.ports.auth.authenticate = async session => session === 'scheduler-only' ? { ok: true, value: { userId: 'scheduler-only', role: 'admin', permissions: ['scheduler'] } } : authenticate(session);
  const unauthorizedClosure = await h.reject('scheduler-only', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'not authorized for negotiation' }, 'Unauthorized');
  await h.ok('admin', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'reviewed' }, 'admin-close');
  await h.ok('admin', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'reviewed' }, 'admin-close');
  const oneClosed = structuredClone(h.repository.state);
  const closedPairMessage = await h.reject('master:master', { type: 'message', chatId: 'chat:job:master', id: 'closed-pair', original: 'No access to the closed pair', photoIds: [], sender: 'user' }, 'ChatClosed');
  await h.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master2', confirmed: true, reason: 'finished' });
  const next = structuredClone(h.repository.state.jobs.job);
  const staleDeadline = await h.reject('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 }, 'StaleRevision');
  h.clock.value = next.cycles[1].countdown.deadline; await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 1 });
  const terminal = structuredClone(h.repository.state.jobs.job);
  const lateRepeatOffer = await h.reject('master:master', { type: 'initial_offer', jobId: 'job', id: 'late-repeat', chatId: 'late-repeat' }, 'PublicationExpired');
  const empty = harness(); await empty.published(); await empty.offer(); await empty.message('master:master');
  const oneSided = structuredClone(empty.repository.state.threads['chat:job:master']); empty.clock.value = empty.repository.state.jobs.job.cycles[0].countdown.deadline;
  await empty.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  const unprotectedWrite = await empty.reject('master:master', { type: 'message', chatId: 'chat:job:master', id: 'expired-one-sided', original: 'Still waiting', photoIds: [], sender: 'user' }, 'ChatClosed');
  const cycles = harness(); await cycles.published(); const durations = []; let earlyCycle, earlyChats;
  for (let index = 0; index < 4; index++) {
    const master = `repeat${index}`; cycles.repository.state.users[master] = user(master, 'master'); await cycles.offer('job', master); await cycles.bilateral('job', master);
    await cycles.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: master, confirmed: true, reason: 'finished early' });
    assert.equal(cycles.repository.state.jobs.job.cycles.length, index + 1);
    if (index === 0) { earlyCycle = structuredClone(cycles.repository.state.jobs.job); earlyChats = structuredClone(cycles.repository.state); }
    cycles.clock.value = cycles.repository.state.jobs.job.cycles[index].countdown.deadline;
    await cycles.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: index }, `deadline${index}`);
    await cycles.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: index }, `deadline${index}`);
    durations.push(cycles.repository.state.jobs.job.cycles[index + 1].countdown.duration);
  }
  const reserved = harness(); await reserved.reserved(); const reservedBefore = structuredClone(reserved.repository.state.jobs.job);
  await reserved.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  const selectedClose = await reserved.reject('admin', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'too late' }, 'InvalidTransition');
  const confirmation = await h.reject('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master2', confirmed: false, reason: '' }, 'ConfirmationRequired');
  const races = [], raceFailures = [];
  for (const closeFirst of [false, true]) {
    const example = harness(); await example.published(); await example.offer();
    await example.ok('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true });
    const close = () => example.execute('admin', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', reason: 'Admin closure', confirmed: true });
    const select = () => example.execute('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1000n, confirmed: true });
    const results = await Promise.all(closeFirst ? [close(), select()] : [select(), close()]);
    const loser = results.find(result => !result.ok); assert.ok(loser); raceFailures.push(loser);
    races.push(results.filter(result => result.ok).length === 1 && example.repository.state.events.filter(event => ['master_selected', 'negotiations_closed'].includes(event.type)).length === 1 && example.repository.state.jobs.job.state === (closeFirst ? 'published' : 'reserved'));
  }
  await proofs(t, [
    ['PUB.1', initial.snapshot.cep === 1000n && initial.snapshot.address === 'PRIVATE EXACT ADDRESS', immutable, 'PublishedSnapshotImmutable', 'draft edits allowed before sole immutable publication'],
    ['PUB.2', initial.snapshot.items.length === 1 && initial.snapshot.photoIds.length > 0 && initial.snapshot.rules.length > 0 && initial.snapshot.catalogKey === 'test-catalog:1', immutable, 'PublishedSnapshotImmutable', 'snapshot preserves scope/photos/CEP/catalog/rules'],
    ['PUB.3', next.id === initial.id && next.snapshot.cep === initial.snapshot.cep && next.snapshot.address === initial.snapshot.address, immutable, 'PublishedSnapshotImmutable', 'another cycle cannot make the original published scope editable'],
    ['PUB.4', h.repository.state.jobs.job.snapshot.cep === initial.snapshot.cep, adminEdit, 'Unauthorized', 'Admin cannot edit published job'],
    ['PUB.5', initial.cycles[0].countdown.duration === 86400 && initial.cycles[0].countdown.policyVersion === h.config.version, lateOffer, 'PublicationExpired', 'first launch deadline snapshotted from policy'],
    ['PUB.6', protectedAfter.cycles.length === 1 && protectedAfter.state === 'published', lateOffer, 'PublicationExpired', 'deadline blocks new offers even when existing protection continues'],
    ['PUB.7', oneSided.masterSpoke && !oneSided.clientSpoke && !oneSided.protected, unprotectedWrite, 'ChatClosed', 'actual one-sided conversation receives no protection and cannot continue after its expiry'],
    ['PUB.8', protectedBefore['chat:job:master'].protected && protectedBefore['chat:job:master2'].protected, unprotectedWrite, 'ChatClosed', 'bilateral conversations survive the deadline, unlike the actual one-sided control'],
    ['PUB.9', Object.values(protectedBefore).filter(c => c.protected).length === 2 && oneClosed.threads['chat:job:master2'].mode === 'temporary', closedPairMessage, 'ChatClosed', 'closing one actual protected pair blocks that pair, not the other protected dialogue'],
    ['PUB.10', empty.repository.state.jobs.job.state === 'expired' && empty.repository.state.jobs.job.cycles.length === 1, unprotectedWrite, 'ChatClosed', 'a genuinely empty/one-sided first cycle is terminal and cannot continue its old dialogue'],
    ['PUB.11', empty.repository.state.threads['chat:job:master'].mode === 'closed' && !empty.repository.state.refusalStreak.master, unprotectedWrite, 'ChatClosed', 'natural one-sided expiry creates no refusal and makes the old dialogue read-only'],
    ['PUB.12', protectedAfter.state === 'published' && protectedAfter.cycles.length === 1, blocked(() => M.evaluatePublication(structuredClone(protectedAfter), { threads: structuredClone(protectedBefore), messages: {} }, h.config, firstDeadline) === 'expired'), null, 'actual deadline evaluation cannot expire a protected bilateral conversation'],
    ['PUB.13', oneClosed.jobs.job.cycles.length === 1 && next.cycles.length === 2, blocked(() => M.evaluatePublication(structuredClone(oneClosed.jobs.job), structuredClone(oneClosed), h.config, firstDeadline) === 'republished'), null, 'actual evaluator cannot start a repeat while another protected pair remains open'],
    ['PUB.14', cycles.repository.state.jobs.job.cycles[0].endedAt === cycles.repository.state.jobs.job.cycles[0].countdown.deadline, blocked(() => M.evaluatePublication(structuredClone(earlyCycle), structuredClone(earlyChats), cycles.config, earlyCycle.cycles[0].countdown.deadline - 1) !== 'unchanged'), null, 'after actual early termination, evaluation just before the saved deadline cannot advance the cycle'],
    ['PUB.15', durations.join(',') === '43200,21600,10800,10800', P.validatePolicy(policy({ repeatDurations: [43200, 0] })), 'InvalidConfiguration', 'configured continuation works and a zero-duration repeat sequence is rejected'],
    ['PUB.16', terminal.state === 'expired' && terminal.cycles.length === 2, lateRepeatOffer, 'PublicationExpired', 'the actual empty repeated cycle is terminal and cannot take a fresh offer'],
    ['PUB.17', terminal.cycles[0].hadBilateral && !terminal.cycles[1].hadBilateral, blocked(() => M.evaluatePublication(structuredClone(next), structuredClone(h.repository.state), h.config, next.cycles[1].countdown.deadline) === 'republished'), null, 'old bilateral history cannot make an actually empty next cycle republish'],
    ['PUB.18', durations.length === 4 && cycles.repository.state.jobs.job.cycles.length === 5, staleDeadline, 'StaleRevision', 'duplicate durable deadline operation never creates second cycle'],
    ['PUB.19', reserved.repository.state.jobs.job.state === 'reserved' && reserved.repository.state.jobs.job.cycles.length === reservedBefore.cycles.length, blocked(() => M.evaluatePublication(structuredClone(reservedBefore), structuredClone(reserved.repository.state), reserved.config, firstDeadline + 1) === 'republished'), null, 'actual late deadline evaluation cannot return a selected/reserved job to the marketplace'],
    ['PUB.20', oneClosed.events.filter(e => e.type === 'negotiations_closed').length === 1 && oneClosed.jobs.job.cycles[0].countdown.deadline === firstDeadline && !oneClosed.refusalStreak.master, unauthorizedClosure, 'Unauthorized', 'one-pair administrative closure is audited and rejects an Admin without negotiation permission'],
    ['PUB.21', oneClosed.jobs.job.cycles[0].countdown.deadline === firstDeadline, noExtend, 'InvalidTransition', 'no supported administrative timer extension operation'],
    ['PUB.22', races.length === 2 && races.every(Boolean), raceFailures[0], 'InvalidTransition', 'both actual concurrent close/select schedules have exactly one compatible transition and a typed losing operation'],
  ], 'publishJob/evaluatePublication/terminateNegotiation/selectMaster', 'apps/backend/src/domain/marketplace.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'Clock']);
});

test('Individual offer evidence', async t => {
  const h = harness(); await h.published(); await h.offer(); await h.offer('job', 'master2'); const initial = structuredClone(h.repository.state.jobs.job.offers.master);
  const originalThread = structuredClone(h.repository.state.threads[initial.chatId]); h.repository.state.threads[initial.chatId].context.jobId = 'foreign-job';
  const foreignOfferLink = await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true }, 'InvalidReference');
  h.repository.state.threads[initial.chatId] = originalThread;
  const noFinal = await h.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', confirmed: true, amount: 1000n }, 'FinalApplicationRequired');
  const discussion = await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: true }, 'DiscussionRequired');
  await h.bilateral();
  const noConfirm = await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: false }, 'ConfirmationRequired');
  const noReason = await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: '', confirmed: true }, 'InvalidMoney');
  const beforeRevision = structuredClone(h.repository.state.jobs.job.offers.master);
  h.repository.failNextCommit = true;
  const failedWrite = await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: true }, 'Conflict');
  await h.ok('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: true }, 'price-once');
  await h.ok('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1200n, reason: 'reason', confirmed: true }, 'price-once');
  const afterRevision = structuredClone(h.repository.state.jobs.job.offers.master);
  const approval = await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: true }, 'ApprovalRequired');
  await h.ok('client:client', { type: 'approve_price', jobId: 'job', masterId: 'master', approved: true, confirmed: true }); const approved = structuredClone(h.repository.state.jobs.job);
  const anotherPrice = await h.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1300n, reason: 'reason', confirmed: true }, 'PriceAlreadyRevised');
  const finalConfirm = await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: false }, 'ConfirmationRequired');
  await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: 'cancelled' }, 'ConfirmationRequired');
  const wrongRecipient = await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'stranger', confirmed: true }, 'ConfirmationRequired');
  await h.ok('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1200n, recipientId: 'client', confirmed: true });
  await h.ok('master2:master', { type: 'final_application', jobId: 'job', masterId: 'master2', amount: 1000n, recipientId: 'client', confirmed: true });
  const final = structuredClone(h.repository.state.jobs.job);
  const selectionConfirm = await h.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: false }, 'ConfirmationRequired');
  await h.ok('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: true }, 'select-once');
  await h.ok('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: true }, 'select-once');
  const selected = structuredClone(h.repository.state.jobs.job);
  const closedFinal = await h.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master2', amount: 1000n, confirmed: true }, 'InvalidTransition');
  const rewrittenFinal = await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1201n, recipientId: 'client', confirmed: true }, 'InvalidTransition');
  const duplicateSelection = await h.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1200n, confirmed: true }, 'InvalidTransition');
  const closedCompetitorMessage = await h.reject('master2:master', { type: 'message', chatId: 'chat:job:master2', id: 'alternative-chat', original: 'Create another selected chat', photoIds: [], sender: 'user' }, 'ChatClosed');
  const unstructured = harness(); await unstructured.published(); await unstructured.offer();
  await unstructured.message('master:master', 'Final application1000 sent. Select me.'); await unstructured.message('client:client', 'I accept and select this Master for1000.');
  const chatTextSelection = await unstructured.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1000n, confirmed: true }, 'FinalApplicationRequired');
  const rejected = harness(); await rejected.published(); await rejected.offer(); await rejected.bilateral(); await rejected.ok('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1100n, reason: 'reason', confirmed: true }); await rejected.ok('client:client', { type: 'approve_price', jobId: 'job', masterId: 'master', approved: false, confirmed: true });
  const secondAfterReject = await rejected.reject('master:master', { type: 'revise_price', jobId: 'job', masterId: 'master', amount: 1150n, reason: 'reason', confirmed: true }, 'PriceAlreadyRevised');
  const types = h.repository.state.events.map(e => e.type);
  await proofs(t, [
    ['OFR.1', initial.jobId === 'job' && initial.masterId === 'master' && initial.catalogKey === 'test-catalog:1' && initial.initialPrice === 1000n && initial.chatId === 'chat:job:master', foreignOfferLink, 'InvalidReference', 'actual offer identity binds its job/master/scope/catalog/price/chat and rejects a saved foreign-job chat link'],
    ['OFR.2', initial.final === null && initial.state === 'open', noFinal, 'FinalApplicationRequired', 'initial response does not automatically send final application'],
    ['OFR.3', final.offers.master2.final.amount === 1000n && final.offers.master2.revised === null, finalConfirm, 'ConfirmationRequired', 'unchanged CEP final requires no fictional revision'],
    ['OFR.4', final.offers.master.final.amount === 1200n, wrongRecipient, 'ConfirmationRequired', 'final confirmation checks actual recipient and sum'],
    ['OFR.5', afterRevision.revised.amount === 1200n, anotherPrice, 'PriceAlreadyRevised', 'only one successfully written price adjustment'],
    ['OFR.6', h.repository.state.threads['chat:job:master'].protected, discussion, 'DiscussionRequired', 'price change only after actual two-party discussion'],
    ['OFR.7', afterRevision.revised.reason === 'reason', noReason, 'InvalidMoney', 'price adjustment requires explanation'],
    ['OFR.8', beforeRevision.revised === null, noConfirm, 'ConfirmationRequired', 'cancelled confirmation consumes no attempt'],
    ['OFR.9', afterRevision.revised.amount === 1200n && types.filter(x => x === 'price_adjustment_requested').length === 1, failedWrite, 'Conflict', 'attempt consumed by successful atomic write only'],
    ['OFR.10', approved.state === 'published' && approved.selectedMasterId === null && approved.offers.master.revised.approvedAt !== null, approval, 'ApprovalRequired', 'client price approval separate from executor selection'],
    ['OFR.11', rejected.repository.state.jobs.job.offers.master.revised.rejectedAt !== null, secondAfterReject, 'PriceAlreadyRevised', 'client rejection never restores revision attempt'],
    ['OFR.12', selected.financial.fap === final.offers.master.final.amount, rewrittenFinal, 'InvalidTransition', 'an actual new Final Application cannot rewrite1200 as1201 after selection'],
    ['OFR.13', selected.selectedMasterId === 'master' && selected.financial.fap === 1200n, selectionConfirm, 'ConfirmationRequired', 'client explicitly confirms master and final sum'],
    ['OFR.14', final.offers.master.final !== null && selected.offers.master2.state === 'closed', closedFinal, 'InvalidTransition', 'closed/invalid final cannot be selected'],
    ['OFR.15', selected.state === 'reserved' && selected.reservation.state === 'reserved' && selected.funds === 'none', closedFinal, 'InvalidTransition', 'selection reserves, never assigns or receives funds'],
    ['OFR.16', h.repository.state.threads['chat:job:master2'].mode === 'closed', closedFinal, 'InvalidTransition', 'selection closes competitors'],
    ['OFR.17', selected.chatId === initial.chatId, closedCompetitorMessage, 'ChatClosed', 'the actual chosen chat identity is preserved and a competing closed chat cannot become an alternative working conversation'],
    ['OFR.18', ['initial_offer_sent', 'price_adjustment_requested', 'price_adjustment_approved', 'final_application_sent', 'master_selected'].every(x => types.includes(x)), chatTextSelection, 'FinalApplicationRequired', 'actual bilateral chat text claiming final price/selection cannot replace the structured Final Application event'],
    ['OFR.19', types.filter(x => x === 'master_selected').length === 1 && types.filter(x => x === 'price_adjustment_requested').length === 1, duplicateSelection, 'InvalidTransition', 'same-operation replay is safe and an actual fresh delivery cannot repeat the same Master selection'],
  ], 'initialOffer/revisePrice/approvePrice/finalApplication/selectMaster', 'apps/backend/src/domain/marketplace.ts', ['AtomicRepository', 'Clock']);
});

test('Individual refusal evidence', async t => {
  const h = harness(); const warningCounts = [];
  for (let i = 1; i <= 4; i++) {
    await h.published(`j${i}`); await h.offer(`j${i}`);
    const command = { type: 'terminate_negotiation', jobId: `j${i}`, masterId: 'master', confirmed: true, reason: 'withdraw' };
    const results = await Promise.all([h.execute('master:master', command, `withdraw${i}`), h.execute('master:master', command, `withdraw${i}`)]);
    assert.ok(results.every(r => r.ok)); warningCounts.push(h.repository.state.refusalStreak.master);
  }
  const withdrawn = structuredClone(h.repository.state);
  const noActive = await h.reject('master:master', { type: 'terminate_negotiation', jobId: 'j1', masterId: 'master', confirmed: true, reason: 'again' }, 'InvalidTransition');
  const reentry = await h.reject('master:master', { type: 'initial_offer', jobId: 'j1', id: 'again', chatId: 'again' }, 'Conflict');
  await h.published(); await h.offer();
  const noConfirm = await h.reject('master:master', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: false, reason: 'cancel' }, 'ConfirmationRequired');
  const windowBefore = await h.repository.read(); await read(h, 'master:master', { type: 'chat_history', chatId: 'chat:job:master' });
  const noWindowEffect = JSON.stringify(await h.repository.read(), (_, v) => typeof v === 'bigint' ? String(v) : v) === JSON.stringify(windowBefore, (_, v) => typeof v === 'bigint' ? String(v) : v);
  const restarted = new FakeRepository(await h.repository.read(), structuredClone(h.repository.receipts)); const restartedCore = new DomainCore({ ...h.ports, repository: restarted });
  const replay = await restartedCore.execute('master:master', 'withdraw1', { type: 'terminate_negotiation', jobId: 'j1', masterId: 'master', confirmed: true, reason: 'withdraw' }); assert.equal(replay.ok, true);
  const beforeCollision = await restarted.read();
  const replayCollision = await restartedCore.execute('client:client', 'withdraw1', { type: 'terminate_negotiation', jobId: 'j1', masterId: 'master', confirmed: true, reason: 'withdraw' });
  err(replayCollision, 'Conflict'); assert.deepEqual(await restarted.read(), beforeCollision);
  const finalClosure = harness(); await finalClosure.published(); await finalClosure.offer();
  await finalClosure.ok('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true });
  const sentFinal = structuredClone(finalClosure.repository.state.jobs.job.offers.master.final);
  await finalClosure.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', reason: 'Declined', confirmed: true });
  const invalidatedFinal = await finalClosure.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 1000n, confirmed: true }, 'InvalidTransition');
  await h.assigned(); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); const acceptedStreak = h.repository.state.refusalStreak.master;
  await h.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'exceptional', evidence: [] });
  const decision = { id: 'exceptional', type: 'exceptional_completion', reason: 'verified client acceptance and absence', evidence: await h.reviewedCompletion('exceptional'), facts: { arrived: true, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true } };
  const earlyCompletion = await h.reject('admin', { type: 'decide_resolution', caseId: 'exceptional', decision }, 'ResolutionRequired');
  h.clock.value = h.repository.state.jobs.job.inactivityThreshold.deadline; await h.ok('admin', { type: 'reminders', jobId: 'job' }); const inactiveStreak = h.repository.state.refusalStreak.master;
  await h.ok('admin', { type: 'decide_resolution', caseId: 'exceptional', decision }, 'completed-once'); await h.ok('admin', { type: 'decide_resolution', caseId: 'exceptional', decision }, 'completed-once');
  const resolution = harness(); await resolution.assigned('card'); await resolution.ok('master:master', { type: 'cancel', jobId: 'job', id: 'request', reason: 'needs review', explanation: 'not automatically voluntary', evidence: [], confirmed: true, classification: 'unclassified', remainingWork: '' });
  const refusal = { id: 'refusal', type: 'master_refusal', reason: 'reviewed', evidence: ['request'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: false, historyReviewed: true } };
  const unproved = await resolution.reject('admin', { type: 'decide_resolution', caseId: 'case:request', decision: refusal }, 'ResolutionRequired');
  await resolution.ok('admin', { type: 'decide_resolution', caseId: 'case:request', decision: { ...refusal, facts: { ...refusal.facts, voluntaryRefusalProven: true } } });
  const clientClose = harness(); await clientClose.published(); await clientClose.offer(); await clientClose.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'no' });
  await proofs(t, [
    ['REF.1', noWindowEffect && windowBefore.jobs.job.offers.master.state === 'open', blocked(async () => { const example = harness(); await example.published(); await example.offer(); const old = await example.repository.read(); await read(example, 'master:master', { type: 'chat_history', chatId: 'chat:job:master' }); return !isDeepStrictEqual(old, await example.repository.read()); }), null, 'actual open-dialogue navigation/history read cannot withdraw an offer, close a chat or record a refusal'],
    ['REF.2', finalClosure.repository.state.jobs.job.offers.master.state === 'closed' && isDeepStrictEqual(finalClosure.repository.state.jobs.job.offers.master.final, sentFinal), invalidatedFinal, 'InvalidTransition', 'actual sent Final Application retains history but becomes unselectable after confirmed termination'],
    ['REF.3', noConfirm.ok === false && acceptedStreak === 4, noConfirm, 'ConfirmationRequired', 'cancelled warning does not mutate refusal state'],
    ['REF.4', warningCounts[0] === 1 && withdrawn.refusals['withdraw:offer:j1:master'].jobId === 'j1', noActive, 'InvalidTransition', 'valid voluntary withdrawal creates one refusal basis'],
    ['REF.5', Object.keys(withdrawn.refusals).length === 4 && h.repository.state.refusals['withdraw:offer:j1:master'].id === 'withdraw:offer:j1:master', noActive, 'InvalidTransition', 'no still-active offer cannot produce another refusal'],
    ['REF.6', !clientClose.repository.state.refusalStreak.master, unproved, 'ResolutionRequired', 'client termination and unproved cancellation are not voluntary master refusal'],
    ['REF.7', withdrawn.jobs.j1.excludedMasters.includes('master') && windowBefore.jobs.job.offers.master.state === 'open', reentry, 'Conflict', 'withdrawal exclusion local to same job'],
    ['REF.8', warningCounts.join(',') === '1,2,3,4' && !('suspended' in withdrawn.users.master), blocked(async () => { const example = harness(); example.repository.state.refusalStreak.master = 999; await example.published(); await example.offer(); return !example.repository.state.jobs.job.offers.master; }), null, 'actual999-refusal input cannot suspend an otherwise valid fresh offer'],
    ['REF.9', withdrawn.events.filter(e => e.type === 'refusal_recorded_warning').length === 1 && withdrawn.events.filter(e => e.type === 'repeated_refusal_warning').length === 3, noActive, 'InvalidTransition', 'first and repeated warnings without automatic blocking threat'],
    ['REF.10', restarted.state.refusalStreak.master === 4 && Object.keys(restarted.state.refusals).length === 4, replayCollision, 'Conflict', 'actual durable replay survives restart but the same operation key cannot be reused by another actor'],
    ['REF.11', warningCounts[3] === 4 && Object.keys(withdrawn.refusals).length === 4, noActive, 'InvalidTransition', 'parallel duplicate requests increment once'],
    ['REF.12', resolution.repository.state.refusalStreak.master === 1 && resolution.repository.state.jobs.job.state === 'cancelled', unproved, 'ResolutionRequired', 'post-assignment refusal only after proved Resolution'],
    ['REF.13', h.repository.state.refusalStreak.master === 0 && h.repository.state.jobs.job.state === 'completed', earlyCompletion, 'ResolutionRequired', 'an actual premature completion attempt cannot reset the streak before a valid completed transition'],
    ['REF.14', h.repository.state.cases.exceptional.decision.type === 'exceptional_completion' && h.repository.state.events.filter(e => e.type === 'refusal_streak_reset').length === 1, earlyCompletion, 'ResolutionRequired', 'actual early Admin completion is rejected before the later valid one-time completion/reset'],
    ['REF.15', acceptedStreak === 4 && inactiveStreak === 4, earlyCompletion, 'ResolutionRequired', 'acceptance, rejected premature completion and reaching inactivity threshold do not themselves reset the streak'],
    ['REF.16', Object.keys(h.repository.state.refusals).length === 4 && h.repository.state.refusalStreak.master === 0, blocked(async () => { const example = harness(); await example.published('withdrawn'); await example.offer('withdrawn'); await example.ok('master:master', { type: 'terminate_negotiation', jobId: 'withdrawn', masterId: 'master', confirmed: true, reason: 'Withdrawal' }); const history = structuredClone(example.repository.state.refusals); await example.completed('cash', 'completed'); return !isDeepStrictEqual(history, example.repository.state.refusals); }), null, 'an actual subsequent completion resets the streak without deleting its prior refusal history'],
  ], 'terminateNegotiation/registerRefusal/completeJob/decideResolution', 'apps/backend/src/domain/marketplace.ts; apps/backend/src/domain/work.ts', ['AtomicRepository', 'Clock']);
});

test('Individual chat and official support evidence', async t => {
  const h = harness(); await h.published(); await h.offer(); await h.offer('job', 'master2');
  const foreign = await h.reject('master2:master', { type: 'message', chatId: 'chat:job:master', id: 'foreign', original: 'foreign', photoIds: [], sender: 'user' }, 'Unauthorized');
  const photoCommand = { type: 'message', chatId: 'chat:job:master', id: 'photo', original: '', photoIds: ['master-image'], sender: 'user' };
  const temporaryPhoto = await h.reject('master:master', photoCommand, 'InvalidPhoto');
  await h.message('client:client', 'RU:first'); const notice = structuredClone(h.repository.state.threads['chat:job:master'].languageNotice);
  const firstMessageId = h.repository.state.threads['chat:job:master'].messageIds[0]; const original = h.repository.state.messages[firstMessageId].original;
  const restart = new DomainCore(h.ports); const beforeHistory = await h.repository.read();
  await read(h, 'master:master', { type: 'chat_history', chatId: 'chat:job:master' });
  const translated = []; for (const locale of ['th', 'ru', 'en']) translated.push(await restart.translateMessage('master:master', firstMessageId, locale));
  await h.message('master:master'); await h.message('client:client', 'RU:same'); const noRepeat = structuredClone(h.repository.state.threads['chat:job:master'].languageNotice);
  await h.message('client:client', 'new language'); const updated = structuredClone(h.repository.state.threads['chat:job:master'].languageNotice);
  await h.message('master:master'); await h.message('client:client', '?unknown'); const uncertain = structuredClone(h.repository.state.threads['chat:job:master'].languageNotice);
  const scopeView = await read(h, 'master:master', { type: 'job', jobId: 'job' });
  const foreignScope = await read(h, 'stranger:client', { type: 'job', jobId: 'job' });
  h.setTranslatorFailure(true); const failedTranslation = await h.core.translateMessage('master:master', firstMessageId, 'th');
  const messageBeforeReplace = structuredClone(h.repository.state.messages[firstMessageId]);
  h.ports.translation = { ...h.ports.translation, async translate(text, source, target) { return { ok: true, value: `${target}:replacement:${text}` }; } };
  const replacement = await h.core.translateMessage('master:master', firstMessageId, 'th');
  await h.assigned(); const assignedChat = h.repository.state.jobs.job.chatId;
  await h.ok('master:master', photoCommand); await h.ok('client:client', { ...photoCommand, id: 'client-photo', photoIds: ['client-image'] });
  const twoPhotos = await h.reject('master:master', { ...photoCommand, id: 'two', photoIds: ['master-a', 'master-b'] }, 'InvalidPhoto');
  for (let i = 0; i < 12; i++) await h.message('master:master', `working ${i}`);
  h.clock.value += 121 * 3600; await h.message('client:client', 'working chat has no TTL');
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); await h.ok('master:master', { type: 'complete', jobId: 'job' });
  const closedMessage = await h.reject('master:master', { ...photoCommand, id: 'closed' }, 'ChatClosed');
  await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 100n, confirmed: true });
  const support = { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' };
  const unauthorizedSupport = await h.reject('master:master', support, 'Unauthorized');
  const invalidSupport = await h.reject('admin', { ...support, basisId: 'missing' }, 'NotFound');
  await h.ok('admin', support, 'support-once'); await h.ok('admin', support, 'support-once');
  const official = { type: 'message', chatId: 'support', id: 'official', original: 'debt paid', photoIds: [], sender: 'helpy' };
  await h.ok('admin', official, 'official-once'); await h.ok('admin', official, 'official-once');
  const spoof = await h.reject('master:master', { ...official, id: 'spoof' }, 'Unauthorized');
  const outsider = await h.reject('stranger:client', { ...official, id: 'outsider', sender: 'user' }, 'Unauthorized');
  await h.ok('master:master', { ...official, id: 'reply', sender: 'user' });
  const supportPhoto = await h.reject('master:master', { ...official, id: 'support-photo', sender: 'user', photoIds: ['master-a'] }, 'InvalidPhoto');
  h.ports.supportAttachments.photosAllowed = () => true;
  await h.ok('master:master', { ...official, id: 'support-two-photos', sender: 'user', photoIds: ['master-a', 'master-b'] });
  const supportTranslation = await h.core.translateMessage('master:master', 'official', 'ru');
  const supportTranslator = h.ports.translation;
  h.ports.translation = { ...supportTranslator, async translate() { return { ok: false, error: { code: 'TranslationUnavailable', detail: 'test outage' } }; } };
  const failedSupportTranslation = await h.core.translateMessage('master:master', 'official', 'th'); h.ports.translation = supportTranslator;
  const duplicateSupportMessage = await h.reject('admin', official, 'Conflict');
  const supportHistory = await read(h, 'master:master', { type: 'chat_history', chatId: 'support' });
  const retainedDebt = h.repository.state.debt.master;
  await h.ok('admin', { type: 'close_repayment', requestId: 'r', reason: 'no confirmed receipt' });
  const survivesRequest = h.repository.state.threads.support.mode === 'support';
  await h.ok('admin', { type: 'close_support', chatId: 'support' });
  const supportClosed = await h.reject('master:master', { ...official, id: 'after-close', sender: 'user' }, 'ChatClosed');
  await proofs(t, [
    ['CHT.1', assignedChat === 'chat:job:master' && supportHistory.ok && supportTranslation.ok, foreign, 'Unauthorized', 'one message core and repository across temporary/work/support contexts'],
    ['CHT.2', h.repository.state.threads['chat:job:master2'].messageIds.length === 0, foreign, 'Unauthorized', 'one offer does not grant access to another chat'],
    ['CHT.3', h.repository.state.messages[firstMessageId].original === original, failedTranslation, 'TranslationUnavailable', 'original message never replaced by translations'],
    ['CHT.4', replacement.ok && replacement.value.translated.includes('replacement'), failedTranslation, 'TranslationUnavailable', 'provider replaced without changing message source'],
    ['CHT.5', translated.every(r => r.ok && r.value.original === original) && translated.map(r => r.value.locale).join(',') === 'th,ru,en', failedTranslation, 'TranslationUnavailable', 'previously loaded message can be represented in all selected locales'],
    ['CHT.6', h.repository.state.messages[firstMessageId].original === messageBeforeReplace.original, failedTranslation, 'TranslationUnavailable', 'translation failure preserves original and business state'],
    ['CHT.7', temporaryPhoto.ok === false, temporaryPhoto, 'InvalidPhoto', 'temporary chat cannot send photos'],
    ['CHT.8', scopeView.ok && Object.values(scopeView.value.job.items[0].photos).flat().length > 0 && scopeView.value.job.exactAddress === null, foreignScope, 'Unauthorized', 'initial scope photos are available through the authorized job view, not an unrelated Client query'],
    ['CHT.9', h.repository.state.threads[assignedChat].messageIds.length > 12 && h.repository.state.messages.photo.photoIds.length === 1 && h.repository.state.messages['client-photo'].photoIds.length === 1, twoPhotos, 'InvalidPhoto', 'one photo per message from either role, unlimited messages'],
    ['CHT.10', h.repository.state.jobs.job.state === 'completed' && h.repository.state.messages[h.repository.state.threads[assignedChat].messageIds.at(-1)].original === 'working chat has no TTL', closedMessage, 'ChatClosed', 'time alone permits working messages; actual completion, not an inactivity deadline, blocks the next message'],
    ['CHT.11', h.repository.state.threads[assignedChat].mode === 'closed', closedMessage, 'ChatClosed', 'completed order chat read-only with history retained'],
    ['CHT.12', notice.language === 'ru' && h.repository.state.users.master.locale === 'en', blocked(async () => { const example = harness(); await example.published(); await example.offer(); await example.ok('client:client', { type: 'locale', locale: 'th' }); await example.message('client:client', 'RU:original'); return example.repository.state.threads['chat:job:master'].languageNotice.language === 'th'; }), null, 'a real TH interface selection cannot replace the detected RU original-language notice'],
    ['CHT.13', uncertain.language === 'en' && !uncertain.pending, blocked(async () => { const example = harness(); await example.published(); await example.offer(); await example.message('client:client', '?unreliable'); return example.repository.state.threads['chat:job:master'].languageNotice !== null; }), null, 'actual unreliable detection with no preceding notice cannot invent a language'],
    ['CHT.14', notice.pending && beforeHistory.threads['chat:job:master'].languageNotice.pending, blocked(async () => { const example = harness(); await example.published(); await example.offer(); const sent = await example.message('client:client', 'RU:original'); await new DomainCore(example.ports).translateMessage('master:master', sent.outcome.message.id, 'en'); await read(example, 'master:master', { type: 'chat_history', chatId: 'chat:job:master' }); return !example.repository.state.threads['chat:job:master'].languageNotice.pending; }), null, 'fresh-core translation/history reads cannot consume the notice before the Master replies'],
    ['CHT.15', updated.language === 'en' && updated.pending, blocked(async () => { const example = harness(); await example.published(); await example.offer(); await example.message('client:client', 'RU:first'); await example.message('master:master'); await example.message('client:client', '?unreliable changed text'); const value = example.repository.state.threads['chat:job:master'].languageNotice; return value.language !== 'ru' || value.pending; }), null, 'reliable changed language renews notice; an unreliable changed original cannot renew or replace it'],
    ['CHT.16', noRepeat.language === 'ru' && !noRepeat.pending, blocked(async () => { const example = harness(); await example.published(); await example.offer(); await example.message('client:client', 'RU:first'); await example.message('master:master'); await example.ok('client:client', { type: 'locale', locale: 'th' }); await example.message('client:client', 'RU:again'); return example.repository.state.threads['chat:job:master'].languageNotice.pending; }), null, 'another actual same-language original cannot repeat the notice even after an interface-language change'],
    ['CHT.17', beforeHistory.jobs.job.offers.master.state === 'open' && original === 'RU:first', blocked(async () => { const old = await h.repository.read(); await read(h, 'master:master', { type: 'chat_history', chatId: assignedChat }); return !isDeepStrictEqual(old, await h.repository.read()); }), null, 'actual window/history read has no job, offer, message or deadline effect'],
    ['SUP.1', h.repository.state.threads.support.context.type === 'support', unauthorizedSupport, 'Unauthorized', 'only Admin can start official support'],
    ['SUP.2', h.repository.state.messages.official.authorId === 'admin' && supportHistory.value.messages[0].authorId === 'helpy', spoof, 'Unauthorized', 'employee audit identity preserved but public sender is Helpy'],
    ['SUP.3', h.repository.state.threads.support.id !== assignedChat && h.repository.state.threads.support.context.userId === 'master', outsider, 'Unauthorized', 'separate support identity with one addressed user'],
    ['SUP.4', h.repository.state.threads.support.context.basisId === 'r', invalidSupport, 'NotFound', 'support refers to actual owned repayment request'],
    ['SUP.5', h.repository.state.messages.reply.authorId === 'master', outsider, 'Unauthorized', 'addressed Master can reply, outsiders cannot'],
    ['SUP.6', supportTranslation.ok && supportTranslation.value.original === 'debt paid', failedSupportTranslation, 'TranslationUnavailable', 'actual support translation uses the same replaceable port and preserves its original during a provider outage'],
    ['SUP.7', survivesRequest && h.repository.state.jobs.job.state === 'completed', closedMessage, 'ChatClosed', 'support survives both related order completion and request closure'],
    ['SUP.8', h.repository.state.threads.support.mode === 'closed' && supportHistory.value.messages.length >= 2, supportClosed, 'ChatClosed', 'explicit support close preserves accessible history'],
    ['SUP.9', survivesRequest && h.repository.state.messages['support-two-photos'].photoIds.length === 2, supportPhoto, 'InvalidPhoto', 'support inherits neither order closure/TTL nor work photo cap'],
    ['SUP.10', h.repository.state.messages['support-two-photos'].photoIds.length === 2, supportPhoto, 'InvalidPhoto', 'support attachments require separate injected permission, no invented numeric limit'],
    ['SUP.11', retainedDebt === 300n && !h.repository.state.receipts.r, blocked(async () => { const example = harness(); await example.completed('cash'); await example.ok('master:master', { type: 'request_repayment', id: 'r', amount: 100n, confirmed: true }); await example.ok('admin', { type: 'support', id: 's', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' }); const old = await example.repository.read(); await example.ok('admin', { type: 'message', id: 'paid-text', chatId: 's', original: 'Debt paid in full. Payment received.', photoIds: [], sender: 'helpy' }); const next = await example.repository.read(); return !isDeepStrictEqual(old.debt, next.debt) || !isDeepStrictEqual(old.ledger, next.ledger) || !isDeepStrictEqual(old.receipts, next.receipts); }), null, 'an actual authorized Helpy message claiming receipt cannot replace the separate financial receipt operation'],
    ['SUP.12', h.repository.state.events.some(e => e.type === 'support_opened' && e.recipients.includes('master')) && h.repository.state.events.some(e => e.type === 'chat_message' && e.subjectId === 'reply' && e.recipients.includes('admin')), outsider, 'Unauthorized', 'support events addressed to actual user/Admin participants'],
    ['SUP.13', h.repository.state.threads.support.messageIds.filter(id => id === 'official').length === 1 && h.repository.state.events.filter(e => e.type === 'support_opened').length === 1, duplicateSupportMessage, 'Conflict', 'same-operation replay is safe and a fresh operation cannot duplicate the persisted official message ID'],
  ], 'sendMessage/history/createSupport/closeSupport/translateMessage', 'apps/backend/src/domain/messaging.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'TranslationPort', 'SupportAttachmentPolicyPort', 'AuthorizationDirectoryPort']);
});

test('Individual payment evidence', async t => {
  const h = harness(); await h.reserved(); const initial = structuredClone(h.repository.state.jobs.job); const original = initial.reservation.countdown;
  const selection = harness(); await selection.published(); await selection.offer();
  await selection.ok('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 1000n, recipientId: 'client', confirmed: true });
  const wrongSelectionAmount = await selection.reject('client:client', { type: 'select_master', jobId: 'job', masterId: 'master', amount: 999n, confirmed: true }, 'FinalApplicationRequired');
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 0n }); const unavailableCash = await h.reject('client:client', { type: 'cash', jobId: 'job' }, 'CashUnavailable');
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: null });
  await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p1', route: 'card' }); const pending = structuredClone(h.repository.state.jobs.job.reservation);
  await h.ok('admin', { type: 'publish_policy', policy: policy({ version: 'reset-version', effectiveAt: 101, paymentSelectionTimeout: 777, providerConfirmation: 1400 }) }); h.clock.value = original.deadline + 100;
  h.outcomes.set('unknown', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'unknown' }); const unknown = await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'unknown' });
  const expiredPending = await h.reject('admin', { type: 'reservation_deadline', jobId: 'job' }, 'PaymentOutcomeUnknown');
  const pendingCash = await h.reject('client:client', { type: 'cash', jobId: 'job' }, 'PaymentOutcomeUnknown');
  const secondPending = await h.reject('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p2', route: 'bank_transfer' }, 'PaymentOutcomeUnknown');
  const pendingCancel = await h.reject('client:client', { type: 'decline_reservation', jobId: 'job', confirmed: true }, 'PaymentOutcomeUnknown');
  h.outcomes.set('failed1', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'failed', reason: 'insufficient_funds' }); const failed1 = await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'failed1' });
  const reset = structuredClone(h.repository.state.jobs.job.reservation.countdown);
  await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'failed1' });
  await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p2', route: 'bank_transfer' }); h.clock.value++;
  h.outcomes.set('failed2', { operationId: 'p2', amount: 1000n, currency: 'THB', status: 'failed', reason: 'raw-provider-secret' }); const failed2 = await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'failed2' });
  const secondReset = structuredClone(h.repository.state.jobs.job.reservation.countdown);
  const afterSecondFailure = structuredClone(h.repository.state.jobs.job.reservation);
  await h.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p3', route: 'promptpay' });
  h.outcomes.set('wrong', { operationId: 'p3', amount: 999n, currency: 'THB', status: 'success' }); const wrongAmount = await h.reject('admin', { type: 'payment_outcome', jobId: 'job', proof: 'wrong' }, 'ProviderConflict');
  h.outcomes.set('wrong-currency', { operationId: 'p3', amount: 1000n, currency: 'USD', status: 'success' }); const wrongCurrency = await h.reject('admin', { type: 'payment_outcome', jobId: 'job', proof: 'wrong-currency' }, 'ProviderConflict');
  h.clock.value = reset.deadline + 10; h.outcomes.set('success', { operationId: 'p3', amount: 1000n, currency: 'THB', status: 'success' });
  await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'success' }); await h.ok('admin', { type: 'payment_outcome', jobId: 'job', proof: 'success' });
  const assigned = structuredClone(h.repository.state.jobs.job);
  h.outcomes.set('contradiction', { operationId: 'p3', amount: 1000n, currency: 'THB', status: 'failed' }); const contradiction = await h.reject('admin', { type: 'payment_outcome', jobId: 'job', proof: 'contradiction' }, 'ProviderConflict');
  const expire = harness(); await expire.reserved(); expire.clock.value += 600; await expire.ok('admin', { type: 'reservation_deadline', jobId: 'job' });
  const afterExpired = await expire.reject('client:client', { type: 'cash', jobId: 'job' }, 'InvalidTransition');
  const cancel = harness(); await cancel.reserved(); await cancel.ok('client:client', { type: 'decline_reservation', jobId: 'job', confirmed: true });
  const missingPolicy = harness({ providerConfirmation: undefined }); await missingPolicy.reserved(); const noProviderPolicy = await missingPolicy.reject('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p', route: 'card' }, 'InvalidConfiguration');
  const noResetForUnknown = blocked(() => { const copy = structuredClone(pending); F.paymentOutcome(copy, { operationId: 'p1', binding: pending.operations[0].binding, amount: 1000n, currency: 'THB', status: 'unknown' }, P.effectivePolicy(h.repository.state.policies, h.clock.value), original.deadline + 100, initial.financial, initial.id); return !isDeepStrictEqual(copy.countdown, original) || copy.resetUsed; });
  await proofs(t, [
    ['PAY.1', initial.financial.fap === 1000n && initial.financial.currency === 'THB' && initial.financial.policyVersion === h.config.version, wrongSelectionAmount, 'FinalApplicationRequired', 'an actual selection cannot create a financial snapshot with999 instead of the sent Final Application1000'],
    ['PAY.2', original.duration === 600 && reset.duration === 777 && !('paymentRetryWindow' in assigned.reservation), P.validatePolicy(policy({ paymentSelectionTimeout: 0 })), 'InvalidConfiguration', 'the one actual configurable countdown rejects a zero-duration payment policy'],
    ['PAY.3', reset.deadline === failed1.events[0].at + 777 && reset.policyVersion === 'reset-version', noResetForUnknown, null, 'the real first failed resets the timer; an actual unknown outcome cannot consume that reset or restart the countdown'],
    ['PAY.4', secondReset.deadline === reset.deadline && secondReset.startedAt === reset.startedAt, blocked(() => { const copy = structuredClone(afterSecondFailure); const operation = copy.operations.find(value => value.id === 'p2'); F.paymentOutcome(copy, { operationId: operation.id, binding: operation.binding, amount: operation.amount, currency: operation.currency, status: 'failed' }, P.effectivePolicy(h.repository.state.policies, h.clock.value), reset.deadline + 10, initial.financial, initial.id); return !isDeepStrictEqual(copy.countdown, reset); }), null, 'actual second failure and an actual late duplicate failed callback cannot reset the consumed countdown again'],
    ['PAY.5', reset.startedAt > original.deadline, noResetForUnknown, null, 'late first reliable failure grants the one reset, but the preceding late unknown outcome does not grant one'],
    ['PAY.6', unknown.outcome.view.status === 'needsResolution' && unknown.outcome.view.deadline === original.deadline, expiredPending, 'PaymentOutcomeUnknown', 'timely pending operation preserves reservation beyond client deadline'],
    ['PAY.7', unknown.outcome.view.operationId === 'p1' && unknown.outcome.view.providerStatus === 'unknown' && unknown.outcome.view.providerDeadline === pending.operations[0].providerDeadline && unknown.outcome.view.blockedReason === 'provider_outcome_unknown', secondPending, 'PaymentOutcomeUnknown', 'typed actual unknown state identifies the original operation/deadlines and blocks the attempted next payment'],
    ['PAY.8', pendingCash.error.code === 'PaymentOutcomeUnknown' && secondPending.error.code === 'PaymentOutcomeUnknown', pendingCash, 'PaymentOutcomeUnknown', 'Cash and alternative payment operations blocked until terminal status'],
    ['PAY.9', assigned.state === 'assigned' && assigned.funds === 'held' && assigned.reservation.operations.filter(p => p.status === 'success').length === 1 && assigned.chatId === initial.chatId, wrongAmount, 'ProviderConflict', 'full FAP success assigns exactly once even after late callback'],
    ['PAY.10', assigned.reservation.operations[2].amount === 1000n && assigned.reservation.operations[2].currency === 'THB', wrongCurrency, 'ProviderConflict', 'callback identity/amount/currency checked'],
    ['PAY.11', assigned.reservation.operations.length === 3 && assigned.reservation.operations[2].status === 'success', contradiction, 'ProviderConflict', 'contradictory terminal provider event permits no new operation'],
    ['PAY.12', unavailableCash.error.code === 'CashUnavailable' && assigned.state === 'assigned', unavailableCash, 'CashUnavailable', 'Cash rechecked against current personal threshold; noncash unaffected'],
    ['PAY.13', cancel.repository.state.jobs.job.state === 'expired', pendingCancel, 'PaymentOutcomeUnknown', 'explicit decline only when no unresolved financial operation'],
    ['PAY.14', expire.repository.state.jobs.job.state === 'expired' && M.feed(expire.repository.state, 'master', expire.repository.state.users.master.specialization, expire.clock.value).length === 0, afterExpired, 'InvalidTransition', 'terminal reserve timeout never returns old job to marketplace'],
    ['PAY.15', initial.funds === 'none' && pending.operations[0].amount === initial.financial.fap, wrongAmount, 'ProviderConflict', 'full payment only, no platform deposit'],
    ['PAY.16', failed1.outcome.view.reason === 'insufficient_funds' && failed2.outcome.view.reason === 'unspecified', blocked(() => JSON.stringify({ state: h.repository.state, receipts: [...h.repository.receipts.values()] }, (_, value) => typeof value === 'bigint' ? String(value) : value).includes('raw-provider-secret')), null, 'actual raw provider reason is absent from stored facts, audit, response receipts and idempotency signatures'],
    ['PAY.17', F.paymentView(initial.reservation, original.startedAt + 100).remaining === 500 && F.paymentView(initial.reservation, original.deadline + 1).remaining === 0, blocked(() => F.paymentView(structuredClone(initial.reservation), original.deadline + 1).remaining > 0), null, 'actual copied persisted reservation cannot restart its countdown after the saved deadline'],
    ['PAY.18', pending.operations[0].providerDeadline === pending.operations[0].initiatedAt + 900 && pending.operations[0].providerDeadline !== original.deadline, noProviderPolicy, 'InvalidConfiguration', 'provider confirmation policy independent and required; no invented default'],
  ], 'initiatePayment/paymentOutcome/chooseCash/paymentView', 'apps/backend/src/domain/finance.ts; apps/backend/src/application/domain-core.ts', ['PaymentProviderPort', 'AtomicRepository', 'Clock']);
});

test('Individual money/payout evidence', async t => {
  const h = harness(); h.repository.state.debt.master = 300n; await h.assigned('card'); await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  const beforeComplete = structuredClone(h.repository.state); h.repository.failNextCommit = true;
  const failedCommit = await h.reject('master:master', { type: 'complete', jobId: 'job' }, 'Conflict');
  await h.ok('master:master', { type: 'complete', jobId: 'job' }, 'complete-once'); await h.ok('master:master', { type: 'complete', jobId: 'job' }, 'complete-once');
  const calculated = structuredClone(h.repository.state.payouts.job);
  h.ports.payments.payoutDestination = async masterId => ({ ok: true, value: { id: 'bank', masterId, route: 'bank_transfer', verified: false, available: true } });
  const unverified = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out1' }, 'DestinationUnverified');
  h.ports.payments.payoutDestination = async masterId => ({ ok: true, value: { id: 'bank', masterId, route: 'bank_transfer', verified: true, available: true } });
  const override = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'override', recoveryRate: ratio(10n) }, 'FixedRecoveryRate');
  await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out1' });
  h.outcomes.set('unknown', { operationId: 'out1', amount: 400n, currency: 'THB', status: 'unknown' }); const waiting = await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'unknown' });
  const pendingRetry = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out2' }, 'PaymentOutcomeUnknown');
  h.outcomes.set('failed', { operationId: 'out1', amount: 400n, currency: 'THB', status: 'failed' }); await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'failed' });
  const afterFailed = structuredClone(h.repository.state);
  const failedRecompletion = await h.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition');
  const retryAmountOverride = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out2', amount: 401n }, 'InvalidConfiguration');
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 3000n });
  await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out2' });
  h.outcomes.set('success', { operationId: 'out2', amount: 400n, currency: 'THB', status: 'success' }); await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'success' }); await h.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'success' });
  const settled = structuredClone(h.repository.state.payouts.job); const terminalRetry = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out3' }, 'InvalidTransition');
  const reusedIncomingId = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'payment:job' }, 'Conflict');
  const changeFinalAfterSelection = await h.reject('master:master', { type: 'final_application', jobId: 'job', masterId: 'master', amount: 999n, recipientId: 'client', confirmed: true }, 'InvalidTransition');
  const uncompleted = harness(); await uncompleted.assigned('card');
  const prematurePayout = await uncompleted.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'too-early' }, 'InvalidTransition');
  const cash = harness(); await cash.assigned(); await cash.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); const acceptedDebt = cash.repository.state.debt.master ?? 0n;
  await cash.ok('master:master', { type: 'complete', jobId: 'job' }, 'cash-complete'); await cash.ok('master:master', { type: 'complete', jobId: 'job' }, 'cash-complete');
  const repeatedComplete = await cash.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition');
  const invalidMoney = checked(() => money(1.5)); const invalidRate = checked(() => portion(100n, ratio(101n)));
  const numeric = [];
  for (const [net, recovery, remaining] of [[105n, 74n, 31n], [101n, 71n, 30n], [1n, 1n, 0n], [0n, 0n, 0n]]) {
    const state = harness().repository.state; state.debt.master = 1000n;
    const snapshot = { ...calculated.snapshot, fap: net === 0n ? 100n : net, commission: ratio(net === 0n ? 100n : 0n) };
    const value = F.calculatePayout(state, 'numeric', 'master', snapshot, 100, 'admin'); assert.equal(value.debtRecovery, recovery); assert.equal(value.amount, remaining);
    numeric.push({ ...value, external: remaining === 0n ? F.initiatePayout(value, h.config, null, 100, 'zero') : null });
  }
  const partialSnapshot = { ...calculated.snapshot, fap: 101n }; const partial = F.allocation(partialSnapshot, 'partial', { clientRefund: 40n, masterCompensation: 31n });
  const badPool = checked(() => F.allocation(partialSnapshot, 'partial', { clientRefund: 36n, masterCompensation: 36n }));
  const roundingFailures = [];
  for (const [commission, debt, altered] of [[ratio(30n), 0n, { commission: 31n, netBeforeDebt: 74n, amount: 74n }], [ratio(0n), 1000n, { debtRecovery: 73n, amount: 32n }]]) {
    const example = harness({ commission }); example.repository.state.debt.master = debt;
    await example.ok('client:client', { type: 'new_job', id: 'job', draft: { items: [scope(example.fixture)], cep: 105n, address: 'private' } });
    await example.ok('client:client', { type: 'publish_job', jobId: 'job' }); await example.completed('card');
    assert.equal(example.repository.state.payouts.job.commission, debt === 0n ? 32n : 0n);
    assert.equal(example.repository.state.payouts.job.debtRecovery, debt === 0n ? 0n : 74n);
    Object.assign(example.repository.state.payouts.job, altered);
    const invalid = await read(example, 'master:master', { type: 'payout', jobId: 'job' }); err(invalid, 'InvalidReference'); roundingFailures.push(invalid);
  }
  const cashCancelled = harness(); await cashCancelled.assigned('cash');
  await cashCancelled.ok('master:master', { type: 'cancel', jobId: 'job', id: 'cash-cancel', reason: 'refusal', explanation: 'Cannot continue', remainingWork: '', classification: 'unclassified', evidence: [], confirmed: true });
  await cashCancelled.ok('admin', { type: 'decide_resolution', caseId: 'case:cash-cancel', decision: { id: 'cash-decision', type: 'master_refusal', reason: 'Actual request reviewed', evidence: ['cash-cancel'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: true, acceptanceReviewed: false, historyReviewed: false } } });
  const commissionAfterCancellation = await cashCancelled.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition');
  const concurrent = harness(); concurrent.repository.state.debt.master = 300n;
  for (const id of ['a', 'b']) { await concurrent.assigned('card', id); await concurrent.ok('client:client', { type: 'accept_work', jobId: id, accepted: true, explanation: '' }); }
  const completions = await Promise.all(['a', 'b'].map(jobId => concurrent.execute('master:master', { type: 'complete', jobId })));
  const both = Object.values(concurrent.repository.state.payouts);
  const duplicateCalculation = await concurrent.reject('master:master', { type: 'complete', jobId: 'a' }, 'InvalidTransition');
  const savedPayout = structuredClone(h.repository.state.payouts.job);
  h.repository.state.payouts.job.debtRecovery = 490n; h.repository.state.payouts.job.amount = 210n;
  const excessiveRecovery = await read(h, 'master:master', { type: 'payout', jobId: 'job' });
  err(excessiveRecovery, 'InvalidReference'); h.repository.state.payouts.job = savedPayout;
  await proofs(t, [
    ['MON.1', calculated.snapshot.currency === 'THB' && typeof calculated.amount === 'bigint', invalidMoney, 'InvalidMoney', 'all money represented as explicit whole THB bigint'],
    ['MON.2', portion(1000n, { numerator: 3n, denominator: 10n }) === 300n, invalidRate, 'InvalidRate', 'exact rational rates, not binary floating money'],
    ['MON.3', portion(101n, ratio(30n)) === 30n && portion(105n, ratio(30n)) === 32n && portion(102n, ratio(30n)) === 31n, roundingFailures[0], 'InvalidReference', 'actual105-THB payout rejects commission31 from rounding31.5 down, even when its corrupted remainder still conserves the fund'],
    ['MON.4', partial.clientRefund + partial.masterCompensation === 71n, badPool, 'FundsMismatch', 'remaining share uses subtraction from rounded commission'],
    ['MON.5', partial.clientRefund + partial.masterCompensation + partial.helpyShare === 101n, badPool, 'FundsMismatch', 'allocation conserves complete held fund'],
    ['MON.6', calculated.snapshot.fap === 1000n && calculated.snapshot.commission.numerator === 30n && settled.snapshot.policyVersion === calculated.snapshot.policyVersion, changeFinalAfterSelection, 'InvalidTransition', 'financial snapshot survives policy/retry and cannot be rewritten by another final application'],
    ['MON.7', cash.repository.state.debt.master === 300n && Object.keys(cash.repository.state.ledger).length === 1, repeatedComplete, 'InvalidTransition', 'Cash completion commission once per job/basis'],
    ['MON.8', acceptedDebt === 0n && Object.keys(beforeComplete.ledger).length === 0 && Object.keys(cashCancelled.repository.state.ledger).length === 0, commissionAfterCancellation, 'InvalidTransition', 'actual Cash cancellation creates no commission debt and cannot later be completed to invent that debt'],
    ['MON.9', h.repository.state.debt.master === 0n && numeric.every(x => x.debtRecovery <= x.debtBefore), checked(() => F.ledger(h.repository.state, { id: 'negative', masterId: 'master', basis: 'negative', change: -1n, at: 100, actorId: 'admin' })), 'DebtChanged', 'no negative balance or excess debt recovery'],
    ['MON.10', Object.keys(h.repository.state.ledger).length === 1 && calculated.debtRecovery === 300n, failedCommit, 'Conflict', 'injected financial commit failure rolls back completed/payout/debt/events before successful retry'],
    ['MON.11', settled.attempts.map(x => x.id).join(',') === 'out1,out2', reusedIncomingId, 'Conflict', 'unique payout/attempt identity includes rejection of an incoming payment ID'],
    ['MON.12', calculated.debtBefore === 300n && calculated.netBeforeDebt === 700n && beforeComplete.jobs.job.funds === 'held' && !beforeComplete.payouts.job, prematurePayout, 'InvalidTransition', 'actual debt calculation is unavailable before completed'],
    ['MON.13', numeric[0].debtRecovery === 74n && numeric[1].debtRecovery === 71n, override, 'FixedRecoveryRate', 'one normative fixed 70 percent formula'],
    ['MON.14', h.repository.state.debt.master === 0n && settled.amount === 400n, override, 'FixedRecoveryRate', 'actual payout command rejects Admin recovery override'],
    ['MON.15', calculated.debtRecovery === calculated.debtBefore && calculated.debtRecovery < portion(700n, ratio(70n)), excessiveRecovery, 'InvalidReference', 'stored recovery490 against actual debtBefore300 is rejected rather than exposed as a valid calculation'],
    ['MON.16', settled.amount === calculated.amount && settled.attempts[1].amount === calculated.amount, retryAmountOverride, 'InvalidConfiguration', 'retry cannot replace the immutable400 amount with401'],
    ['MON.17', completions.every(r => r.ok) && both.reduce((sum, x) => sum + x.debtRecovery, 0n) === 300n && concurrent.repository.state.debt.master === 0n, duplicateCalculation, 'InvalidTransition', 'parallel calculations consume actual debt once and a second calculation for the same completed job is rejected'],
    ['MON.18', afterFailed.debt.master === 0n && afterFailed.jobs.job.state === 'completed' && afterFailed.payouts.job.amount === 400n, failedRecompletion, 'InvalidTransition', 'failed transfer does not reopen completion or allow a second debt recovery/calculation'],
    ['MON.19', waiting.outcome.execution.state === 'needsResolution' && waiting.outcome.execution.operationId === 'out1', pendingRetry, 'PaymentOutcomeUnknown', 'pending/unknown payout blocks another transfer'],
    ['MON.20', numeric.filter(x => x.amount === 0n).every(x => x.external === null && x.attempts.length === 0), blocked(() => numeric.filter(value => value.amount === 0n).some(value => F.initiatePayout(value, h.config, null, 100, 'zero-probe') !== null || value.attempts.length > 0)), null, 'actual zero-amount payout input suppresses any external instruction without requiring a destination'],
    ['MON.21', settled.attempts[0].destinationId === 'bank' && settled.settled, unverified, 'DestinationUnverified', 'positive transfer requires verified linked destination and route'],
    ['MON.22', calculated.commission === 300n && calculated.debtRecovery === 300n && calculated.amount === 400n && settled.attempts[1].amount === 400n, retryAmountOverride, 'InvalidConfiguration', 'exact1000/300/400 failed-transfer/retry: even an Admin cannot retry401 instead of400'],
    ['MON.23', numeric.map(x => `${x.netBeforeDebt}/${x.debtRecovery}/${x.amount}`).join(',') === '105/74/31,101/71/30,1/1/0,0/0/0', roundingFailures[1], 'InvalidReference', 'actual net105 rejects recovery73 from rounding73.5 down; net105/net101/net1/net0 exact results remain verified'],
  ], 'portion/calculatePayout/initiatePayout/payoutOutcome/ledger/completeJob', 'apps/backend/src/domain/finance.ts; apps/backend/src/domain/core.ts; apps/backend/src/domain/work.ts', ['AtomicRepository', 'PaymentProviderPort', 'Clock']);
});

test('Individual debt and voluntary repayment evidence', async t => {
  const h = harness(); h.repository.state.debt.master = 1000n;
  const global = F.debtView(h.repository.state, 'master', h.config);
  const preselectionAvailability = await read(h, 'client:client', { type: 'cash_availability', masterId: 'master' });
  const wrongAvailabilityRole = await read(h, 'master:master', { type: 'cash_availability', masterId: 'master' });
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 3000n }); await h.ok('admin', { type: 'threshold', masterId: 'master2', amount: 2000n });
  const personal = F.debtView(h.repository.state, 'master', h.config); const other = F.debtView(h.repository.state, 'master2', h.config);
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: null }); const removed = F.debtView(h.repository.state, 'master', h.config);
  const badThreshold = await h.reject('admin', { type: 'threshold', masterId: 'master', amount: -1n }, 'InvalidMoney');
  const unauthorizedRemoval = await h.reject('master:master', { type: 'threshold', masterId: 'master2', amount: null }, 'Unauthorized');
  const foreignZeroDebt = await read(h, 'master:master', { type: 'debt', masterId: 'master2' });
  const cashGate = harness(); cashGate.repository.state.debt.master = 1000n; await cashGate.reserved();
  const blockedCash = await cashGate.reject('client:client', { type: 'cash', jobId: 'job' }, 'CashUnavailable');
  await cashGate.ok('client:client', { type: 'initiate_payment', jobId: 'job', id: 'noncash-still-allowed', route: 'card' });
  const badAmount = await h.reject('master:master', { type: 'request_repayment', id: 'bad', amount: 1001n, confirmed: true }, 'InvalidRepayment');
  const noConfirm = await h.reject('master:master', { type: 'request_repayment', id: 'bad', amount: 300n, confirmed: false }, 'ConfirmationRequired');
  await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true }, 'request-once'); await h.ok('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true }, 'request-once');
  const requested = structuredClone(h.repository.state);
  const duplicateRequest = await h.reject('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true }, 'Conflict');
  const foreignRequest = await read(h, 'master2:master', { type: 'repayment', requestId: 'r' });
  const wrongSupportOwner = await h.reject('admin', { type: 'support', id: 'wrong-owner', userId: 'master2', userRole: 'master', basis: 'repayment', basisId: 'r' }, 'InvalidReference');
  await h.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' });
  const wrongMethod = await h.reject('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'work_off', agreementId: 'a' }, 'InvalidRepayment');
  await h.ok('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'bank_transfer', agreementId: 'a' });
  const receipt = { type: 'receive_repayment', requestId: 'r', masterId: 'master', amount: 300n, receiptId: 'receipt', agreementId: 'a', actuallyReceived: true, evidence: 'received by platform' };
  const unconfirmed = await h.reject('admin', { ...receipt, actuallyReceived: false }, 'ReceiptUnconfirmed');
  const wrongMaster = await h.reject('admin', { ...receipt, masterId: 'master2' }, 'Unauthorized');
  const unauthorized = await h.reject('master:master', receipt, 'Unauthorized');
  await Promise.all([h.ok('admin', receipt, 'receipt-once'), h.ok('admin', receipt, 'receipt-once')]);
  const received = structuredClone(h.repository.state); const duplicate = await h.reject('admin', receipt, 'InvalidRepayment');
  const changed = harness(); changed.repository.state.debt.master = 300n; await changed.ok('master:master', { type: 'request_repayment', id: 'r', amount: 300n, confirmed: true }); await changed.ok('admin', { type: 'support', id: 'support', userId: 'master', userRole: 'master', basis: 'repayment', basisId: 'r' });
  await changed.ok('admin', { type: 'agree_repayment', requestId: 'r', amount: 300n, method: 'cash', agreementId: 'a' });
  await changed.completed('card'); const debtChanged = await changed.reject('admin', receipt, 'DebtChanged');
  const closed = harness(); closed.repository.state.debt.master = 200n; await closed.ok('master:master', { type: 'request_repayment', id: 'r', amount: 200n, confirmed: true }); await closed.ok('admin', { type: 'close_repayment', requestId: 'r', reason: 'no actual funds' });
  const closedReceipt = await closed.reject('admin', { ...receipt, amount: 200n }, 'InvalidRepayment');
  await proofs(t, [
    ['DBT.1', global.effectiveMasterDebtThreshold === 1000n, P.validatePolicy(policy({ globalDebtThreshold: -1n })), 'InvalidMoney', 'actual global debt-threshold configuration resolves its default and rejects a negative global amount'],
    ['DBT.2', personal.effectiveMasterDebtThreshold === 3000n && other.effectiveMasterDebtThreshold === 2000n, badThreshold, 'InvalidMoney', 'independent per-master overrides take priority'],
    ['DBT.3', removed.effectiveMasterDebtThreshold === 1000n && F.debtView(h.repository.state, 'master2', h.config).effectiveMasterDebtThreshold === 2000n, unauthorizedRemoval, 'Unauthorized', 'actual Admin removal falls back to global while another Master cannot remove the independent override'],
    ['DBT.4', !global.cashAvailable && personal.cashAvailable && removed.mode === 'noncash_only' && cashGate.repository.state.jobs.job.reservation.operations.length === 1, blockedCash, 'CashUnavailable', 'at-threshold state rejects an actual Cash command but still accepts a noncash payment operation'],
    ['DBT.5', preselectionAvailability.ok && preselectionAvailability.value.mode === 'noncash_only' && Object.keys(h.repository.state.jobs).length === 0, wrongAvailabilityRole, 'Unauthorized', 'actual Client cash-availability read works before selection; wrong role cannot use that read path'],
    ['DBT.6', F.debtView(h.repository.state, 'master2', h.config).outstandingDebt === 0n && F.debtView(h.repository.state, 'master2', h.config).currency === 'THB', foreignZeroDebt, 'Unauthorized', 'zero debt is a real debt view, but still does not permit another Master to inspect it'],
    ['DBT.7', requested.repayments.r.amount === 300n && requested.debt.master === 1000n, badAmount, 'InvalidRepayment', 'positive whole repayment request cannot exceed actual debt'],
    ['DBT.8', requested.repayments.r.status === 'requested', noConfirm, 'ConfirmationRequired', 'master explicitly confirms request submission'],
    ['DBT.9', Object.keys(requested.repayments).length === 1 && Object.keys(requested.ledger).length === 0 && requested.events.some(e => e.type === 'debt_repayment_requested' && e.recipients.includes('admin')), duplicateRequest, 'Conflict', 'actual same-request-ID creation under a fresh operation is rejected without another request/event/ledger effect'],
    ['DBT.10', received.repayments.r.supportChatId === 'support' && received.threads.support.context.basisId === 'r', wrongSupportOwner, 'InvalidReference', 'actual official support creation cannot bind this request to another Master'],
    ['DBT.11', received.receipts.receipt.method === 'bank_transfer' && changed.repository.state.repayments.r.method === 'cash', wrongMethod, 'InvalidRepayment', 'exactly cash or bank transfer repayment methods'],
    ['DBT.12', received.receipts.receipt.amount === 300n, wrongMethod, 'InvalidRepayment', 'no work-off or negotiated withholding percentage'],
    ['DBT.13', received.receipts.receipt.actorId === 'admin' && received.debt.master === 700n, unauthorized, 'Unauthorized', 'only explicit authorized receipt operation reduces debt'],
    ['DBT.14', received.receipts.receipt.masterId === 'master' && received.receipts.receipt.requestId === 'r' && received.debt.master2 === undefined, wrongMaster, 'Unauthorized', 'receipt bound to exact master and request'],
    ['DBT.15', changed.repository.state.debt.master === 0n && changed.repository.state.repayments.r.status === 'agreed', debtChanged, 'DebtChanged', 'current debt rechecked after payout withholding'],
    ['DBT.16', changed.repository.state.repayments.r.amount === 300n && changed.repository.state.repayments.r.agreedAmount === 300n && !changed.repository.state.receipts.receipt, debtChanged, 'DebtChanged', 'debt mismatch never silently alters agreed/original amount or receipt'],
    ['DBT.17', Object.keys(received.ledger).length === 1 && received.debt.master === 700n, duplicate, 'InvalidRepayment', 'parallel/durable receipt replay has one financial effect'],
    ['DBT.18', closed.repository.state.debt.master === 200n && Object.keys(closed.repository.state.ledger).length === 0 && !unconfirmed.ok, closedReceipt, 'InvalidRepayment', 'actual unconfirmed and closed-request receipt attempts both leave the debt unchanged'],
    ['DBT.19', received.events.some(e => e.type === 'debt_repayment_received') && received.receipts.receipt.evidence === 'received by platform', foreignRequest, 'Unauthorized', 'audit retained and other master cannot inspect request'],
    ['DBT.20', F.debtView(received, 'master', h.config).cashAvailable && !F.debtView(requested, 'master', h.config).cashAvailable, unconfirmed, 'ReceiptUnconfirmed', 'future Cash availability changes only after confirmed debt reduction'],
  ], 'debtView/setThreshold/requestRepayment/agreeRepayment/receiveRepayment', 'apps/backend/src/domain/finance.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'AuthenticationPort', 'AuthorizationDirectoryPort']);
});

const decision = (type, facts = {}, shares) => ({ id: `decision:${type}`, type, reason: 'reviewed circumstances', evidence: type === 'mutual' ? ['cancel'] : ['master-evidence'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: false, acceptanceReviewed: true, historyReviewed: true, ...facts }, ...(shares ? { shares } : {}) });
async function cancellation(h, type, method = 'card') {
  await h.assigned(method);
  if (type === 'mutual') {
    await h.ok('client:client', { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'client cancellation', explanation: 'before arrival', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' });
    await h.ok('master:master', { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  } else await h.ok('master:master', { type: 'cancel', jobId: 'job', id: 'cancel', reason: type, explanation: 'review circumstances', evidence: ['master-evidence'], confirmed: true, classification: type === 'master_refusal' ? 'unclassified' : type, remainingWork: type === 'partial' ? 'remaining installation' : '' });
}
test('Individual work and Resolution evidence', async t => {
  const h = harness(); await h.assigned('card'); const assigned = structuredClone(h.repository.state.jobs.job);
  const unpaid = harness(); await unpaid.reserved();
  const unpaidAcceptance = await unpaid.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }, 'InvalidTransition');
  await unpaid.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: 'Not assigned yet' }, 'InvalidTransition');
  const beforeAcceptance = await h.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition');
  const blankRejection = await h.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: '' }, 'EvidenceRequired');
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: 'correction' });
  await h.ok('master:master', { type: 'submit_result', jobId: 'job', explanation: 'corrected', photoIds: [] });
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: false, explanation: 'correct again' });
  await h.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); const accepted = structuredClone(h.repository.state.jobs.job);
  let prematureDestinationLookups = 0; const payoutDestination = h.ports.payments.payoutDestination;
  h.ports.payments.payoutDestination = async masterId => { prematureDestinationLookups++; return payoutDestination(masterId); };
  const prematureNormalPayout = await h.reject('admin', { type: 'start_payout', jobId: 'job', attemptId: 'not-completed' }, 'InvalidTransition');
  assert.equal(prematureDestinationLookups, 0); h.ports.payments.payoutDestination = payoutDestination;
  const acceptedCancel = await h.reject('client:client', { type: 'cancel', jobId: 'job', id: 'late', reason: 'late', explanation: 'late', confirmed: true, classification: 'ordinary', remainingWork: '', evidence: [] }, 'InvalidTransition');
  await h.ok('master:master', { type: 'complete', jobId: 'job' }, 'done'); await h.ok('master:master', { type: 'complete', jobId: 'job' }, 'done');
  const completed = structuredClone(h.repository.state.jobs.job); const afterCompleted = await h.reject('client:client', { type: 'open_resolution', jobId: 'job', id: 'late-case', evidence: [] }, 'InvalidTransition');
  const afterCompletedMessage = await h.reject('master:master', { type: 'message', chatId: completed.chatId, id: 'after-completion', original: 'Closed', photoIds: [], sender: 'user' }, 'ChatClosed');
  const dialogue = harness(); await dialogue.assigned('cash');
  const chatClosureCancellation = await dialogue.reject('admin', { type: 'close_support', chatId: dialogue.repository.state.jobs.job.chatId }, 'InvalidTransition');
  const mutual = harness(); await mutual.assigned('card');
  const cancelCommand = { type: 'cancel', jobId: 'job', id: 'cancel', reason: 'client request', explanation: 'before arrival', evidence: [], classification: 'ordinary', remainingWork: '', confirmed: true };
  const unconfirmed = await mutual.reject('client:client', { ...cancelCommand, confirmed: false }, 'ConfirmationRequired');
  await mutual.ok('client:client', cancelCommand); const cancellationRequested = structuredClone(mutual.repository.state.jobs.job);
  const cannotAccept = await mutual.reject('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }, 'ResolutionRequired');
  const noDisputeReason = await mutual.reject('master:master', { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: false, explanation: '' }, 'EvidenceRequired');
  await mutual.ok('master:master', { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' });
  const unauthorized = await mutual.reject('master:master', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('mutual') }, 'Unauthorized');
  const invented = await mutual.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('invented_fee') }, 'ResolutionRequired');
  await mutual.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('mutual') }, 'resolution-once');
  await mutual.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('mutual') }, 'resolution-once');
  const mutualDone = structuredClone(mutual.repository.state);
  const conflicting = await mutual.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('master_refusal', { voluntaryRefusalProven: true }) }, 'InvalidTransition');
  const timeout = harness(); await timeout.assigned('card'); await timeout.ok('client:client', cancelCommand); timeout.clock.value += timeout.config.cancellationResponse;
  await timeout.ok('admin', { type: 'reminders', jobId: 'job' }); const timedOut = structuredClone(timeout.repository.state.jobs.job);
  const lateConsent = await timeout.reject('master:master', { type: 'cancellation_response', jobId: 'job', workStopped: true, financialConsent: true, explanation: '' }, 'InvalidTransition');
  const arrived = harness(); await cancellation(arrived, 'mutual');
  const arrivedMutual = await arrived.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('mutual', { arrived: true }) }, 'ResolutionRequired');
  const partial = harness(); await cancellation(partial, 'partial'); const partialOriginal = structuredClone(partial.repository.state.jobs.job.snapshot);
  const badPool = await partial.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('partial', { partialWork: true }, { clientRefund: 500n, masterCompensation: 300n }) }, 'FundsMismatch');
  const falseForPartial = await partial.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('false_call', { arrived: true, partialWork: true }) }, 'EvidenceRequired');
  const unboundPartialEvidence = await partial.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { ...decision('partial', { partialWork: true }, { clientRefund: 400n, masterCompensation: 300n }), evidence: ['nonexistent-partial-evidence'] } }, 'EvidenceRequired');
  const rewritePartialFacts = await partial.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { ...decision('partial', { partialWork: true }, { clientRefund: 400n, masterCompensation: 300n }), fap: 999n, acceptedAt: 1, originalScope: [] } }, 'ResolutionRequired');
  const noRemaining = harness(); await cancellation(noRemaining, 'master_refusal');
  const missingRemainingWork = await noRemaining.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('partial', { partialWork: true }, { clientRefund: 400n, masterCompensation: 300n }) }, 'EvidenceRequired');
  await partial.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('partial', { partialWork: true }, { clientRefund: 400n, masterCompensation: 300n }) });
  const partialSplit = partial.repository.state.cases['case:cancel'].decision.allocation;
  const falseCall = harness(); await cancellation(falseCall, 'false_call');
  const noArrival = await falseCall.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('false_call') }, 'EvidenceRequired');
  await falseCall.ok('admin', { type: 'publish_policy', policy: policy({ version: 'new-fees', effectiveAt: 101, falseCallFee: ratio(80n), falseCallMasterShare: ratio(40n) }) }); falseCall.clock.value = 101;
  await falseCall.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('false_call', { arrived: true }) });
  const falseSplit = falseCall.repository.state.cases['case:cancel'].decision.allocation;
  const applyNewRatesAgain = await falseCall.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: { ...decision('false_call', { arrived: true }), id: 'replace-with-current-rates' } }, 'InvalidTransition');
  const ordinaryCommissionAfterFalseCall = await falseCall.reject('master:master', { type: 'complete', jobId: 'job' }, 'InvalidTransition');
  const roundedFalseCall = harness();
  await roundedFalseCall.ok('client:client', { type: 'new_job', id: 'job', draft: { items: [scope(roundedFalseCall.fixture)], cep: 103n, address: 'private' } });
  await roundedFalseCall.ok('client:client', { type: 'publish_job', jobId: 'job' }); await cancellation(roundedFalseCall, 'false_call');
  await roundedFalseCall.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('false_call', { arrived: true }) });
  const compensationId = 'decision:false_call:compensation'; assert.equal(roundedFalseCall.repository.state.obligations[compensationId].amount, 15n);
  roundedFalseCall.repository.state.obligations[compensationId].amount = 16n;
  const independentFalseCallRounding = await roundedFalseCall.reject('admin', { type: 'start_settlement', obligationId: compensationId, attemptId: 'double-rounded' }, 'InvalidReference');
  const cash = harness(); await cancellation(cash, 'false_call', 'cash'); await cash.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('false_call', { arrived: true }) });
  const phantomCashRefund = await cash.reject('admin', { type: 'start_settlement', obligationId: 'decision:false_call:refund', attemptId: 'cash-refund' }, 'NotFound');
  const phantomZeroCompensation = await mutual.reject('admin', { type: 'start_settlement', obligationId: 'decision:mutual:compensation', attemptId: 'zero-compensation' }, 'NotFound');
  const refusal = harness(); await cancellation(refusal, 'master_refusal'); const refusalBefore = structuredClone(refusal.repository.state);
  const notProven = await refusal.reject('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('master_refusal') }, 'ResolutionRequired');
  await refusal.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('master_refusal', { voluntaryRefusalProven: true }) });
  const acceptedCase = harness(); acceptedCase.repository.state.refusalStreak.master = 2; await acceptedCase.assigned('card'); await acceptedCase.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' });
  await acceptedCase.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  const early = await acceptedCase.reject('admin', { type: 'decide_resolution', caseId: 'case', decision: decision('exceptional_completion') }, 'ResolutionRequired');
  const earlyState = structuredClone(acceptedCase.repository.state); acceptedCase.clock.value = acceptedCase.repository.state.jobs.job.inactivityThreshold.deadline;
  await acceptedCase.ok('admin', { type: 'reminders', jobId: 'job' }); const thresholdState = structuredClone(acceptedCase.repository.state);
  await acceptedCase.ok('admin', { type: 'decide_resolution', caseId: 'case', decision: { ...decision('exceptional_completion'), evidence: await acceptedCase.reviewedCompletion('case') } });
  const neverAccepted = harness(); await neverAccepted.assigned('card'); await neverAccepted.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] }); neverAccepted.clock.value += 120 * 3600;
  const noAcceptance = await neverAccepted.reject('admin', { type: 'decide_resolution', caseId: 'case', decision: decision('exceptional_completion') }, 'ResolutionRequired');
  const winners = [], completionRaceFailures = [];
  for (const adminFirst of [false, true]) {
    const race = harness(); race.repository.state.refusalStreak.master = 2; await race.assigned(); await race.ok('client:client', { type: 'accept_work', jobId: 'job', accepted: true, explanation: '' }); await race.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] }); race.clock.value += 120 * 3600;
    const evidence = await race.reviewedCompletion('case');
    const masterCompletes = () => race.execute('master:master', { type: 'complete', jobId: 'job' }); const adminCompletes = () => race.execute('admin', { type: 'decide_resolution', caseId: 'case', decision: { ...decision('exceptional_completion'), evidence } });
    const results = await Promise.all(adminFirst ? [adminCompletes(), masterCompletes()] : [masterCompletes(), adminCompletes()]);
    completionRaceFailures.push(results.find(result => !result.ok));
    winners.push(results.filter(r => r.ok).length === 1 && race.repository.state.debt.master === 300n && race.repository.state.events.filter(e => e.type === 'refusal_streak_reset').length === 1);
  }
  await proofs(t, [
    ['WRK.1', assigned.state === 'assigned' && assigned.reservation.operations[0].status === 'success' && assigned.funds === 'held', unpaidAcceptance, 'InvalidTransition', 'an actual reserved-but-unpaid order cannot enter work acceptance before assignment'],
    ['WRK.2', M.address(assigned, actor('master', 'master')) === 'PRIVATE EXACT ADDRESS', checked(() => M.address(assigned, actor('master2', 'master'))), 'Unauthorized', 'address limited to actually assigned master'],
    ['WRK.3', assigned.evidence.length === 0 && accepted.acceptedAt !== null, blankRejection, 'EvidenceRequired', 'evidence not required for acceptance; rejection explanation is required'],
    ['WRK.4', accepted.state === 'client_accepted' && assigned.state === 'assigned', unpaidAcceptance, 'InvalidTransition', 'actual accept/reject commands work from assigned/working but both are rejected while merely reserved'],
    ['WRK.5', completed.evidence[0].explanation === 'corrected' && h.repository.state.events.filter(e => e.type === 'correction_requested').length === 2, blankRejection, 'EvidenceRequired', 'repeated correction cycle has no artificial iteration limit'],
    ['WRK.6', accepted.funds === 'held' && completed.state === 'completed', beforeAcceptance, 'InvalidTransition', 'client acceptance then distinct master completion'],
    ['WRK.7', accepted.funds === 'held' && !beforeAcceptance.ok && earlyState.payouts.job === undefined && prematureDestinationLookups === 0, prematureNormalPayout, 'InvalidTransition', 'actual client acceptance alone cannot initiate normal payout or even resolve an external payout destination'],
    ['WRK.8', cancellationRequested.cancellation !== null && cancellationRequested.funds === 'held', cannotAccept, 'ResolutionRequired', 'active cancellation suspends normal acceptance/completion'],
    ['WRK.9', h.repository.state.threads[completed.chatId].mode === 'closed' && h.repository.state.events.filter(e => e.type === 'completed').length === 1 && h.repository.state.refusalStreak.master === 0, afterCompletedMessage, 'ChatClosed', 'actual completion makes the same job chat read-only and resets exactly once'],
    ['WRK.10', dialogue.repository.state.jobs.job.state === 'assigned' && !dialogue.repository.state.jobs.job.cancellation && assigned.chatId === 'chat:job:master', chatClosureCancellation, 'InvalidTransition', 'the actual generic support-close operation cannot close/cancel a working order through its job-chat ID'],
    ['WRK.11', accepted.state === 'client_accepted' && accepted.acceptanceOperationId !== null, acceptedCancel, 'InvalidTransition', 'ordinary cancellation forbidden after acceptance'],
    ['WRK.12', h.repository.state.jobs.job.state === 'completed', afterCompleted, 'InvalidTransition', 'completed order cannot be reopened into dispute'],
    ['WRK.13', winners.every(Boolean), completionRaceFailures[0], 'InvalidTransition', 'both actual concurrent completion schedules have one compatible financial result and a typed losing completion'],
    ['RES.1', cancellationRequested.cancellation.reason === 'client request' && cancellationRequested.cancellation.explanation === 'before arrival', unconfirmed, 'ConfirmationRequired', 'explicit warning plus structured reason/explanation/evidence'],
    ['RES.2', mutualDone.jobs.job.cancellation.workStopped && mutualDone.jobs.job.cancellation.financialConsent, noDisputeReason, 'EvidenceRequired', 'work cessation and financial agreement are separate facts'],
    ['RES.3', noDisputeReason.ok === false && timedOut.cancellation.financialConsent === null, noDisputeReason, 'EvidenceRequired', 'financial dispute requires explanation and does not imply consent'],
    ['RES.4', timedOut.resolutionId === 'case:cancel' && timedOut.funds === 'held' && timeout.repository.state.cases['case:cancel'].status === 'admin_resolution_pending', lateConsent, 'InvalidTransition', 'the actual eight-hour no-response case escalates and cannot later record ordinary timely consent'],
    ['RES.5', mutualDone.cases['case:cancel'].decision.allocation.clientRefund === 850n && mutualDone.cases['case:cancel'].decision.allocation.helpyShare === 150n, arrivedMutual, 'ResolutionRequired', 'actual arrived=true decision input cannot use the before-arrival mutual15-percent outcome'],
    ['RES.6', falseCall.repository.state.jobs.job.cancellation.evidence.includes('master-evidence') && falseSplit.clientRefund === 700n, noArrival, 'EvidenceRequired', 'False Call requires actual arrival fact and master photo evidence'],
    ['RES.7', falseSplit.masterCompensation === 150n && falseSplit.helpyShare === 150n && falseCall.repository.state.jobs.job.financial.policyVersion === falseCall.config.version, applyNewRatesAgain, 'InvalidTransition', 'actual policy changes do not affect the original snapshot and cannot replace its terminal financial allocation'],
    ['RES.8', F.allocation({ ...assigned.financial, fap: 103n }, 'false_call').helpyShare === 16n && F.allocation({ ...assigned.financial, fap: 103n }, 'false_call').masterCompensation === 15n, independentFalseCallRounding, 'InvalidReference', 'the actual103-THB False Call rejects an independently rounded16-THB master obligation instead of the correct15'],
    ['RES.9', falseSplit.clientRefund + falseSplit.masterCompensation + falseSplit.helpyShare === 1000n && Object.keys(falseCall.repository.state.ledger).length === 0, ordinaryCommissionAfterFalseCall, 'InvalidTransition', 'an actual terminal False Call cannot be completed again to charge the ordinary commission'],
    ['RES.10', partialSplit.clientRefund === 400n && partialSplit.masterCompensation === 300n, falseForPartial, 'EvidenceRequired', 'partial work excludes fixed mutual/False Call fees'],
    ['RES.11', partial.repository.state.jobs.job.cancellation.remainingWork === 'remaining installation' && partial.repository.state.jobs.job.cancellation.evidence.length === 1, missingRemainingWork, 'EvidenceRequired', 'an actual case with photo evidence but no master remaining-work description cannot settle as partial work'],
    ['RES.12', partialSplit.helpyShare === 300n && partialSplit.clientRefund + partialSplit.masterCompensation === 700n, badPool, 'FundsMismatch', 'partial settlement pool is held FAP minus snapshotted commission'],
    ['RES.13', partialSplit.clientRefund + partialSplit.masterCompensation + partialSplit.helpyShare === 1000n, badPool, 'FundsMismatch', 'inconsistent independently rounded shares rejected'],
    ['RES.14', cash.repository.state.cases['case:cancel'].decision.allocation === null && Object.keys(cash.repository.state.obligations).length === 0 && !cash.repository.state.debt.master, phantomCashRefund, 'NotFound', 'actual Cash cancellation creates no financial refund obligation that an Admin could send'],
    ['RES.15', refusal.repository.state.refusalStreak.master === 1 && refusal.repository.state.cases['case:cancel'].decision.allocation.clientRefund === 1000n, notProven, 'ResolutionRequired', 'proved voluntary refusal full refund and one refusal'],
    ['RES.16', refusalBefore.jobs.job.funds === 'held' && refusalBefore.cases['case:cancel'].status === 'admin_resolution_pending' && !refusalBefore.refusalStreak.master && Object.keys(refusalBefore.obligations).length === 0, notProven, 'ResolutionRequired', 'unclassified master request has no automatic penalty/refund/payout'],
    ['RES.17', partial.repository.state.cases['case:cancel'].decision.actorId === 'admin' && partial.repository.state.cases['case:cancel'].decision.evidence.length > 0 && !unauthorized.ok, unboundPartialEvidence, 'EvidenceRequired', 'actual decision authorization is checked and even an authorized Admin cannot use nonexistent partial-work evidence'],
    ['RES.18', mutualDone.cases['case:cancel'].decision.type === 'mutual', invented, 'ResolutionRequired', 'Admin cannot invent a new financial outcome'],
    ['RES.19', Object.values(mutualDone.obligations).reduce((sum, x) => sum + x.amount, 0n) === 850n && mutualDone.events.filter(e => e.type === 'resolution_decided').length === 1, conflicting, 'InvalidTransition', 'single terminal allocation and one external obligation per positive beneficiary'],
    ['RES.20', mutualDone.events.filter(e => e.type === 'resolution_decided').length === 1, conflicting, 'InvalidTransition', 'duplicate decision cannot repeat or replace settlement'],
    ['RES.21', JSON.stringify(partial.repository.state.jobs.job.snapshot, (_, v) => typeof v === 'bigint' ? String(v) : v) === JSON.stringify(partialOriginal, (_, v) => typeof v === 'bigint' ? String(v) : v) && completed.acceptedAt === accepted.acceptedAt, rewritePartialFacts, 'ResolutionRequired', 'an actual Admin decision input cannot carry FAP/acceptance/scope overrides into immutable source facts'],
    ['RES.22', Object.values(mutualDone.obligations).every(x => x.amount > 0n) && !Object.values(mutualDone.obligations).some(x => x.kind === 'compensation'), phantomZeroCompensation, 'NotFound', 'actual zero master compensation creates no obligation that an Admin could turn into an external transfer'],
    ['RES.23', earlyState.jobs.job.state === 'client_accepted' && earlyState.jobs.job.funds === 'held' && earlyState.refusalStreak.master === 2 && earlyState.cases.case.status === 'admin_resolution_pending' && !earlyState.payouts.job, early, 'ResolutionRequired', 'accepted exceptional case before threshold remains pending with no financial/streak effects'],
    ['RES.24', thresholdState.jobs.job.state === 'client_accepted' && thresholdState.refusalStreak.master === 2 && thresholdState.payouts.job === undefined, early, 'ResolutionRequired', 'threshold alone does not complete/refund/pay or reset'],
    ['RES.25', acceptedCase.repository.state.jobs.job.state === 'completed' && acceptedCase.repository.state.cases.case.decision.acceptanceOperationId !== null && acceptedCase.repository.state.payouts.job.amount === 700n, noAcceptance, 'ResolutionRequired', 'Admin accepted completion after threshold and reviewed proof runs same financial process'],
    ['RES.26', neverAccepted.repository.state.jobs.job.state === 'assigned' && !neverAccepted.repository.state.payouts.job, noAcceptance, 'ResolutionRequired', 'unaccepted work cannot be exceptionally completed'],
    ['RES.27', winners.length === 2 && winners.every(Boolean), completionRaceFailures[1], 'InvalidTransition', 'actual opposite-order Master/Admin completion race rejects its losing completion and produces one reset/commission'],
  ], 'acceptWork/completeJob/requestCancellation/decideResolution/allocation', 'apps/backend/src/domain/work.ts; apps/backend/src/domain/finance.ts', ['AtomicRepository', 'PhotoMetadataPort', 'Clock']);
});

test('Individual reviews and history evidence', async t => {
  const h = harness(); let withoutReview;
  for (const [id, stars, marks] of [['a', 5, ['agreements_kept']], ['b', 1, []], ['c', 4, []]]) {
    await h.completed('cash', id); withoutReview = R.reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master');
    await h.ok('client:client', { type: 'review', jobId: id, id: `review:${id}`, stars, marks, comment: id === 'b' ? '' : 'original' });
  }
  const wrongAuthor = await h.reject('master:master', { type: 'review', jobId: 'a', id: 'foreign', stars: 5, marks: [], comment: '' }, 'Unauthorized');
  const duplicate = await h.reject('client:client', { type: 'review', jobId: 'a', id: 'second', stars: 5, marks: [], comment: '' }, 'Conflict');
  await h.published('not-completed'); const notCompleted = await h.reject('client:client', { type: 'review', jobId: 'not-completed', id: 'early', stars: 5, marks: [], comment: '' }, 'InvalidTransition');
  const stars = checked(() => R.createReview({ reviews: {}, hiddenHistory: {} }, h.repository.state.jobs.a, actor('client', 'client'), { id: 'invalid', stars: 6, marks: [], comment: '' }, 100));
  const marks = checked(() => R.createReview({ reviews: {}, hiddenHistory: {} }, h.repository.state.jobs.a, actor('client', 'client'), { id: 'invalid', stars: 5, marks: ['unknown'], comment: '' }, 100));
  const unauthorized = await h.reject('client:client', { type: 'hide_review', reviewId: 'review:b', reason: 'policy' }, 'Unauthorized');
  const noReason = await h.reject('admin', { type: 'hide_review', reviewId: 'review:b', reason: '' }, 'EvidenceRequired');
  const original = structuredClone(h.repository.state.reviews['review:b']); await h.ok('admin', { type: 'hide_review', reviewId: 'review:b', reason: 'policy violation' });
  assert.equal(h.repository.state.events.find(event => event.type === 'review_hidden' && event.subjectId === 'review:b').facts.reason, 'policy violation');
  const visible = R.reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master');
  const mixedVisibility = structuredClone(h.repository.state);
  for (const id of ['a', 'c']) await h.ok('admin', { type: 'hide_review', reviewId: `review:${id}`, reason: 'policy violation' });
  const none = R.reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master');
  const beforeHide = await h.repository.read(); await h.ok('client:client', { type: 'hide_history', jobId: 'a' });
  const clientHistory = await read(h, 'client:client', { type: 'history' }); const masterHistory = await read(h, 'master:master', { type: 'history' });
  const foreignHide = await h.reject('stranger:client', { type: 'hide_history', jobId: 'a' }, 'Unauthorized');
  await proofs(t, [
    ['REP.1', h.repository.state.reviews['review:a'].jobId === 'a' && h.repository.state.jobs.a.state === 'completed', wrongAuthor, 'Unauthorized', 'only order client may create one review after completed'],
    ['REP.2', withoutReview.experience === 3 && withoutReview.reviewsCount === 2, notCompleted, 'InvalidTransition', 'completed work without submitted review adds experience, never auto-review'],
    ['REP.3', [1, 5, 4].every(n => Object.values(h.repository.state.reviews).some(r => r.stars === n)), stars, 'InvalidScope', 'integer review rating 1 through5'],
    ['REP.4', original.marks.length === 0 && original.comment === '', marks, 'InvalidScope', 'marks and comment optional, only known marks permitted'],
    ['REP.5', visible.reviewsCount === 2 && h.repository.state.reviews['review:a'].createdAt > 0, duplicate, 'Conflict', 'review immediately published without approval queue'],
    ['REP.6', visible.workQuality === 4.5 && visible.reliability === 0.5 && visible.reviewsCount === 2, blocked(() => { const summary = R.reputation(mixedVisibility, Object.values(mixedVisibility.jobs), 'master'); return summary.reviewsCount !== 2 || summary.workQuality !== 4.5 || summary.reliability !== 0.5; }), null, 'an actual mixed-visibility input cannot include the hidden1-star review in public aggregates'],
    ['REP.7', withoutReview.experience === 3 && none.experience === 3, blocked(() => R.reputation({ reviews: {}, hiddenHistory: {} }, Object.values(h.repository.state.jobs), 'master').experience !== 3), null, 'actual absent-review input cannot erase the experience of three completed orders'],
    ['REP.8', none.workQuality === null && none.reliability === null && none.reviewsCount === 0, blocked(() => R.reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master').workQuality !== null), null, 'fresh actual aggregate with no public reviews never fabricates a rating'],
    ['REP.9', visible.workQuality === 4.5 && visible.reliability === 1 / 2 && visible.reviewsCount === 2 && visible.experience === 3, blocked(() => R.reputation(mixedVisibility, Object.values(mixedVisibility.jobs), 'master').reviews.some(review => review.id === 'review:b')), null, 'the required5/hidden1/4 example actually excludes the hidden record rather than merely denying a moderation command'],
    ['REP.10', none.reviewsCount === 0 && none.experience === 3 && none.workQuality === null && none.reliability === null, blocked(() => R.reputation(h.repository.state, Object.values(h.repository.state.jobs), 'master').experience !== 3), null, 'fresh actual aggregate after all reviews hidden preserves completed experience'],
    ['REP.11', h.repository.state.reviews['review:b'].moderation.actorId === 'admin' && h.repository.state.reviews['review:b'].moderation.reason === 'policy violation', noReason, 'EvidenceRequired', 'only authorized moderation with reason and audit fact'],
    ['REP.12', h.repository.state.reviews['review:b'].stars === original.stars && h.repository.state.reviews['review:b'].comment === original.comment && h.repository.state.reviews['review:b'].marks.length === original.marks.length, blocked(async () => { const example = harness(); await example.completed(); await example.ok('client:client', { type: 'review', jobId: 'job', id: 'source', stars: 5, marks: ['agreements_kept'], comment: 'Original' }); const review = structuredClone(example.repository.state.reviews.source); await example.ok('admin', { type: 'hide_review', reviewId: 'source', reason: 'Moderation', stars: 1, marks: [], comment: 'Rewritten' }); const hidden = example.repository.state.reviews.source; return hidden.stars !== review.stars || hidden.comment !== review.comment || !isDeepStrictEqual(hidden.marks, review.marks) || hidden.id !== review.id || hidden.jobId !== review.jobId; }), null, 'an actual authorized Admin hide with forged content fields cannot rewrite the source review'],
    ['REP.13', visible.reviews.length === 2 && !visible.reviews.some(r => r.id === 'review:b') && none.reviews.length === 0, blocked(() => R.reputation(mixedVisibility, Object.values(mixedVisibility.jobs), 'master').reviews.some(review => review.hidden)), null, 'actual public-list computation cannot expose a hidden record'],
    ['REP.14', h.config.historyLimit === 60 && clientHistory.value.jobs.length === 2 && masterHistory.value.jobs.length === 3, checked(() => R.orderHistory(h.repository.state, Object.values(h.repository.state.jobs), actor('client', 'client'), 0)), 'InvalidConfiguration', 'per-role history obeys the configured positive limit and rejects an actual zero-limit input'],
    ['REP.15', clientHistory.value.jobs.every(j => j.id !== 'a') && masterHistory.value.jobs.some(j => j.id === 'a'), foreignHide, 'Unauthorized', 'history hiding affects only caller view'],
    ['REP.16', Object.keys(h.repository.state.jobs).length === Object.keys(beforeHide.jobs).length && h.repository.state.jobs.a.state === 'completed' && h.repository.state.debt.master === beforeHide.debt.master && none.experience === 3, blocked(async () => { const old = await h.repository.read(); await h.ok('client:client', { type: 'hide_history', jobId: 'a' }); const next = await h.repository.read(); return !isDeepStrictEqual(old.jobs, next.jobs) || !isDeepStrictEqual(old.ledger, next.ledger) || !isDeepStrictEqual(old.reviews, next.reviews) || R.reputation(next, Object.values(next.jobs), 'master').experience !== 3; }), null, 'actual authorized repeated history hiding cannot delete or mutate canonical jobs/ledger/reviews/experience'],
  ], 'createReview/hideReview/reputation/hideHistory/orderHistory', 'apps/backend/src/domain/reputation.ts; apps/backend/src/application/queries.ts', ['AtomicRepository', 'AuthenticationPort']);
});

async function payReserved(h, jobId, method = 'card') {
  if (method === 'cash') return h.ok('client:client', { type: 'cash', jobId });
  const id = `pay:${jobId}`; await h.ok('client:client', { type: 'initiate_payment', jobId, id, route: method });
  h.outcomes.set(id, { operationId: id, amount: 1000n, currency: 'THB', status: 'success' });
  return h.ok('admin', { type: 'payment_outcome', jobId, proof: id });
}
async function nextCycle(h, index) {
  const master = `cycle-master${index}`; h.repository.state.users[master] = user(master, 'master');
  await h.offer('job', master); await h.bilateral('job', master);
  await h.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: master, confirmed: true, reason: 'no selection' });
  h.clock.value = M.cycle(h.repository.state.jobs.job).countdown.deadline;
  await h.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: index });
}
const parameterSpecs = {
  initialDuration: [1000, 0], initialAutoClose: [false, 'yes'], repeatDurations: [[18000, 14400], []], repeatFloor: [3600, 0],
  negotiationFirstReminder: [5, 0], negotiationRepeatReminder: [7, 0], paymentSelectionTimeout: [777, 0], providerConfirmation: [1400, 0],
  clientPaymentRoutes: [['cash'], ['unknown']], masterPayoutRoutes: [[], ['cash']], commission: [ratio(40n), ratio(101n)],
  globalDebtThreshold: [2000n, -1n], mutualCancellationFee: [ratio(20n), ratio(-1n)], falseCallFee: [ratio(40n), ratio(101n)], falseCallMasterShare: [ratio(40n), ratio(-1n)],
  cancellationResponse: [40000, 0], cancellationReminder: [2000, 0], inactivityFirstReminder: [100 * 3600, 0], inactivityRepeatReminder: [7200, 0], inactivityThreshold: [150 * 3600, 0],
  historyLimit: [2, 0], locales: [['en', 'ru', 'th', 'de'], ['INVALID']],
  communicationRetention: [{ value: 180, unit: 'days' }, { value: 0, unit: 'days' }], evidenceRetention: [{ value: 180, unit: 'days' }, { value: 0, unit: 'days' }],
  financialRetention: [{ value: 2, unit: 'years' }, { value: 0, unit: 'years' }], auditRetention: [{ value: 2, unit: 'years' }, { value: 0, unit: 'years' }], accountRetention: [{ value: 2, unit: 'years' }, { value: 0, unit: 'years' }],
};
const matrix = [];
test('Every section11.5 parameter: actual UseCase, authorization, new fact, old fact, invalid input', async t => {
  for (const [parameter, [nextValue, invalidValue]] of Object.entries(parameterSpecs)) {
    const h = harness(); let oldFact, newFact, initialValue = h.config[parameter], oldUnchanged = false, dependentFailure = null;
    const oldKey = parameter.startsWith('communication') ? 'communication:old' : parameter.startsWith('evidence') ? 'evidence:old' : parameter.startsWith('financial') ? 'financial:ledger:commission:old' : null;
    let currentRecordKey = oldKey;
    if (['initialDuration', 'initialAutoClose', 'repeatDurations', 'repeatFloor'].includes(parameter)) {
      await h.published(); if (parameter === 'repeatDurations') await nextCycle(h, 0);
      if (parameter === 'repeatFloor') for (let i = 0; i < 4; i++) await nextCycle(h, i);
      oldFact = structuredClone(M.cycle(h.repository.state.jobs.job));
    } else if (parameter.startsWith('negotiation')) { await h.published(); await h.offer(); await h.message('client:client'); oldFact = structuredClone(h.repository.state.threads['chat:job:master'].reminder); }
    else if (['paymentSelectionTimeout', 'providerConfirmation', 'clientPaymentRoutes', 'globalDebtThreshold'].includes(parameter)) {
      if (parameter === 'globalDebtThreshold') h.repository.state.debt.master = 1500n;
      await h.reserved('old'); oldFact = structuredClone(h.repository.state.jobs.old.financial);
      if (parameter === 'paymentSelectionTimeout') oldFact = structuredClone(h.repository.state.jobs.old.reservation.countdown);
      if (['providerConfirmation', 'clientPaymentRoutes'].includes(parameter)) { await h.ok('client:client', { type: 'initiate_payment', jobId: 'old', id: 'p1', route: 'card' }); oldFact = structuredClone(h.repository.state.jobs.old.reservation.operations[0]); }
    } else if (['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'].includes(parameter)) { await h.reserved('old'); oldFact = structuredClone(h.repository.state.jobs.old.financial); }
    else if (parameter === 'masterPayoutRoutes') { await h.completed('card', 'old'); await h.completed('card', 'new'); await h.ok('admin', { type: 'start_payout', jobId: 'old', attemptId: 'out1' }); oldFact = structuredClone(h.repository.state.payouts.old); }
    else if (parameter.startsWith('cancellation')) { await h.assigned('card', 'old'); await h.ok('client:client', { type: 'cancel', jobId: 'old', id: 'old-cancel', reason: 'before arrival', explanation: 'cannot proceed', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' }); oldFact = structuredClone(h.repository.state.jobs.old.cancellation); }
    else if (parameter.startsWith('inactivity')) { await h.assigned('card'); oldFact = structuredClone({ reminder: h.repository.state.jobs.job.inactivityReminder, threshold: h.repository.state.jobs.job.inactivityThreshold }); }
    else if (parameter === 'historyLimit') { for (const id of ['a', 'b', 'c']) { await h.completed('cash', id); h.clock.value++; } oldFact = structuredClone(h.repository.state.jobs); }
    else if (parameter === 'locales') { oldFact = structuredClone(h.repository.state.published[h.repository.state.current]); }
    else if (parameter.endsWith('Retention')) {
      if (parameter === 'accountRetention') { h.claims.set('old-account', { id: 'old-account', purpose: 'login', identity: { method: 'google', subject: 'old-account' }, email: 'old-account@test.invalid', phone: null, ownerId: null, expiresAt: h.clock.value + 1000 }); assert.equal((await h.core.authenticate('old-account', 'old-account', 'old-account')).ok, true); currentRecordKey = 'account:old-account'; }
      else { await h.completed('cash', 'old'); if (parameter === 'auditRetention') currentRecordKey = Object.keys(h.repository.state.retention).find(k => k.startsWith('audit:')); }
      oldFact = structuredClone(h.repository.state.retention[currentRecordKey]);
    } else throw new Error(`Missing setup for ${parameter}`);
    const next = { ...h.config, [parameter]: nextValue, version: `matrix:${parameter}`, effectiveAt: h.clock.value + 1 };
    const unauthorized = await h.reject('client:client', { type: 'publish_policy', policy: next }, 'Unauthorized');
    const invalidCode = parameter === 'locales' ? 'InvalidLocale' : ['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'].includes(parameter) ? 'InvalidRate' : parameter === 'globalDebtThreshold' ? 'InvalidMoney' : 'InvalidConfiguration';
    const invalid = await h.reject('admin', { type: 'publish_policy', policy: { ...next, [parameter]: invalidValue } }, invalidCode);
    const publication = await h.ok('admin', { type: 'publish_policy', policy: next });
    if (parameter === 'auditRetention') assert.equal(h.repository.state.retention[`audit:${publication.events.at(-1).id}`].policyVersion, h.config.version, 'future retention policy cannot apply to current audit event');
    h.clock.value = next.effectiveAt;
    if (['initialDuration', 'initialAutoClose'].includes(parameter)) {
      oldUnchanged = JSON.stringify(M.cycle(h.repository.state.jobs.job)) === JSON.stringify(oldFact);
      await h.published('new'); newFact = M.cycle(h.repository.state.jobs.new);
      assert.equal(parameter === 'initialAutoClose' ? newFact.countdown : newFact.countdown.duration, parameter === 'initialAutoClose' ? null : nextValue);
      if (parameter === 'initialAutoClose') {
        const disabled = harness({ initialAutoClose: false }); await disabled.published(); const enable = { ...disabled.config, version: 'enabled', effectiveAt: 101, initialAutoClose: true };
        await disabled.ok('admin', { type: 'publish_policy', policy: enable }); disabled.clock.value = 101; await disabled.published('new');
        assert.equal(disabled.repository.state.jobs.job.cycles[0].countdown, null); assert.equal(disabled.repository.state.jobs.new.cycles[0].countdown.policyVersion, 'enabled');
      }
    } else if (parameter === 'repeatDurations' || parameter === 'repeatFloor') {
      oldUnchanged = JSON.stringify(M.cycle(h.repository.state.jobs.job)) === JSON.stringify(oldFact); await nextCycle(h, oldFact.index); newFact = M.cycle(h.repository.state.jobs.job);
      assert.equal(newFact.countdown.duration, parameter === 'repeatFloor' ? nextValue : nextValue[1]); assert.equal(newFact.countdown.policyVersion, next.version);
    } else if (parameter.startsWith('negotiation')) {
      oldUnchanged = JSON.stringify(h.repository.state.threads['chat:job:master'].reminder) === JSON.stringify(oldFact);
      if (parameter === 'negotiationFirstReminder') await h.message('master:master'); else { h.clock.value = oldFact.deadline; await h.ok('admin', { type: 'reminders', jobId: 'job' }); }
      newFact = h.repository.state.threads['chat:job:master'].reminder; assert.equal(newFact.duration, nextValue); assert.equal(newFact.policyVersion, next.version);
    } else if (parameter === 'paymentSelectionTimeout') {
      oldUnchanged = JSON.stringify(h.repository.state.jobs.old.reservation.countdown) === JSON.stringify(oldFact);
      await h.ok('client:client', { type: 'initiate_payment', jobId: 'old', id: 'p1', route: 'card' }); h.outcomes.set('failure', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'failed' }); await h.ok('admin', { type: 'payment_outcome', jobId: 'old', proof: 'failure' });
      newFact = h.repository.state.jobs.old.reservation.countdown; assert.equal(newFact.duration, nextValue); assert.equal(newFact.policyVersion, next.version);
    } else if (parameter === 'providerConfirmation') {
      oldUnchanged = h.repository.state.jobs.old.reservation.operations[0].providerDeadline === oldFact.providerDeadline;
      h.outcomes.set('failure', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'failed' }); await h.ok('admin', { type: 'payment_outcome', jobId: 'old', proof: 'failure' }); await h.ok('client:client', { type: 'initiate_payment', jobId: 'old', id: 'p2', route: 'card' });
      newFact = h.repository.state.jobs.old.reservation.operations[1]; assert.equal(newFact.providerDeadline - newFact.initiatedAt, nextValue); assert.equal(newFact.providerTimer.policyVersion, next.version);
    } else if (parameter === 'clientPaymentRoutes') {
      oldUnchanged = h.repository.state.jobs.old.reservation.operations[0].status === oldFact.status;
      h.outcomes.set('success', { operationId: 'p1', amount: 1000n, currency: 'THB', status: 'success' }); await h.ok('admin', { type: 'payment_outcome', jobId: 'old', proof: 'success' });
      await h.reserved('new'); dependentFailure = await h.reject('client:client', { type: 'initiate_payment', jobId: 'new', id: 'new-card', route: 'card' }, 'RouteUnavailable'); await h.ok('client:client', { type: 'cash', jobId: 'new' }); newFact = h.repository.state.jobs.new.state; assert.equal(newFact, 'assigned');
    } else if (parameter === 'masterPayoutRoutes') {
      oldUnchanged = h.repository.state.payouts.old.attempts[0].providerDeadline === oldFact.attempts[0].providerDeadline;
      dependentFailure = await h.reject('admin', { type: 'start_payout', jobId: 'new', attemptId: 'blocked' }, 'RouteUnavailable');
      h.outcomes.set('paid', { operationId: 'out1', amount: 700n, currency: 'THB', status: 'success' }); await h.ok('admin', { type: 'payout_outcome', jobId: 'old', proof: 'paid' });
      await h.ok('admin', { type: 'publish_policy', policy: { ...next, version: 'routes-restored', effectiveAt: h.clock.value + 1, masterPayoutRoutes: ['bank_transfer'] } }); h.clock.value++; await h.ok('admin', { type: 'start_payout', jobId: 'new', attemptId: 'allowed' }); newFact = h.repository.state.payouts.new.attempts[0]; assert.equal(newFact.amount, 700n);
    } else if (parameter === 'globalDebtThreshold') {
      oldUnchanged = h.repository.state.jobs.old.financial.policyVersion === oldFact.policyVersion;
      assert.equal(F.debtView(h.repository.state, 'master', h.config).cashAvailable, false); assert.equal(F.debtView(h.repository.state, 'master', next).cashAvailable, true); await h.ok('client:client', { type: 'cash', jobId: 'old' }); newFact = F.debtView(h.repository.state, 'master', next); assert.equal(newFact.effectiveMasterDebtThreshold, nextValue);
    } else if (['commission', 'mutualCancellationFee', 'falseCallFee', 'falseCallMasterShare'].includes(parameter)) {
      oldUnchanged = h.repository.state.jobs.old.financial.policyVersion === oldFact.policyVersion; await h.reserved('new'); assert.deepEqual(h.repository.state.jobs.new.financial[parameter], nextValue);
      if (parameter === 'commission') {
        for (const id of ['old', 'new']) { await payReserved(h, id, 'cash'); await h.ok('client:client', { type: 'accept_work', jobId: id, accepted: true, explanation: '' }); await h.ok('master:master', { type: 'complete', jobId: id }); }
        assert.equal(h.repository.state.ledger['commission:old'].change, 300n); assert.equal(h.repository.state.ledger['commission:new'].change, 400n); newFact = h.repository.state.ledger['commission:new'];
      } else {
        const type = parameter === 'mutualCancellationFee' ? 'mutual' : 'false_call'; const splits = [];
        for (const id of ['old', 'new']) {
          await payReserved(h, id);
          await h.ok(type === 'mutual' ? 'client:client' : 'master:master', { type: 'cancel', jobId: id, id: `cancel:${id}`, reason: type, explanation: 'structured facts', evidence: type === 'mutual' ? [] : ['master-evidence'], confirmed: true, classification: type === 'mutual' ? 'ordinary' : 'false_call', remainingWork: '' });
          if (type === 'mutual') await h.ok('master:master', { type: 'cancellation_response', jobId: id, workStopped: true, financialConsent: true, explanation: '' });
          await h.ok('admin', { type: 'decide_resolution', caseId: `case:cancel:${id}`, decision: { ...decision(type, { arrived: type === 'false_call' }), id: `decision:${id}`, evidence: type === 'mutual' ? [`cancel:${id}`] : ['master-evidence'] } }); splits.push(h.repository.state.cases[`case:cancel:${id}`].decision.allocation);
        }
        assert.equal(splits[0].clientRefund, type === 'mutual' ? 850n : 700n); assert.equal(splits[0].masterCompensation, type === 'mutual' ? 0n : 150n);
        assert.equal(splits[1].clientRefund, parameter === 'mutualCancellationFee' ? 800n : parameter === 'falseCallFee' ? 600n : 700n);
        if (parameter === 'falseCallMasterShare') assert.equal(splits[1].masterCompensation, 120n); newFact = splits[1];
      }
    } else if (parameter.startsWith('cancellation')) {
      oldUnchanged = h.repository.state.jobs.old.cancellation.responseTimer.deadline === oldFact.responseTimer.deadline && h.repository.state.jobs.old.cancellation.reminder.deadline === oldFact.reminder.deadline;
      if (parameter === 'cancellationResponse') { await h.assigned('cash', 'new'); await h.ok('client:client', { type: 'cancel', jobId: 'new', id: 'new-cancel', reason: 'new', explanation: 'new', evidence: [], confirmed: true, classification: 'ordinary', remainingWork: '' }); newFact = h.repository.state.jobs.new.cancellation.responseTimer; }
      else { h.clock.value = oldFact.reminder.deadline; await h.ok('admin', { type: 'reminders', jobId: 'old' }); newFact = h.repository.state.jobs.old.cancellation.reminder; }
      assert.equal(newFact.duration, nextValue); assert.equal(newFact.policyVersion, next.version);
    } else if (parameter.startsWith('inactivity')) {
      oldUnchanged = h.repository.state.jobs.job.inactivityReminder.deadline === oldFact.reminder.deadline && h.repository.state.jobs.job.inactivityThreshold.deadline === oldFact.threshold.deadline;
      if (parameter === 'inactivityRepeatReminder') { h.clock.value = oldFact.reminder.deadline; await h.ok('admin', { type: 'reminders', jobId: 'job' }); }
      else await h.message('client:client', 'new activity starts a new countdown');
      newFact = parameter === 'inactivityThreshold' ? h.repository.state.jobs.job.inactivityThreshold : h.repository.state.jobs.job.inactivityReminder; assert.equal(newFact.duration, nextValue); assert.equal(newFact.policyVersion, next.version);
    } else if (parameter === 'historyLimit') {
      oldUnchanged = Object.keys(oldFact).every(id => h.repository.state.jobs[id].completedAt === oldFact[id].completedAt); newFact = await read(h, 'client:client', { type: 'history' }); assert.equal(newFact.value.jobs.length, 2); assert.equal(Object.keys(h.repository.state.jobs).length, 3);
    } else if (parameter === 'locales') {
      oldUnchanged = h.repository.state.published[h.repository.state.current].texts[0].revision === oldFact.texts[0].revision; await h.ok('client:client', { type: 'locale', locale: 'de' }); newFact = h.repository.state.users.client.locale; assert.equal(newFact, 'de');
    } else if (parameter.endsWith('Retention')) {
      oldUnchanged = JSON.stringify(h.repository.state.retention[currentRecordKey]) === JSON.stringify(oldFact);
      if (parameter === 'accountRetention') { h.claims.set('new-account', { id: 'new-account', purpose: 'login', identity: { method: 'email_otp', subject: 'new-account@test.invalid' }, email: 'new-account@test.invalid', phone: null, ownerId: null, expiresAt: h.clock.value + 1000 }); assert.equal((await h.core.authenticate('new-account', 'new-account', 'new-account')).ok, true); newFact = h.repository.state.retention['account:new-account']; }
      else if (parameter === 'auditRetention') { const command = await h.ok('client:client', { type: 'feedback', id: 'new-audit', original: 'feedback' }); newFact = h.repository.state.retention[`audit:${command.events[0].id}`]; }
      else { await h.completed('cash', 'new'); newFact = h.repository.state.retention[currentRecordKey.replace(/old$/, 'new')]; }
      assert.equal(newFact.deadline, h.clock.add(newFact.anchor, nextValue)); assert.equal(newFact.policyVersion, next.version);
    }
    assert.equal(oldUnchanged, true, `${parameter}: previously running/recorded fact changed`);
    matrix.push({ parameter, initialValue, nextValue, invalidValue, effectiveVersion: next.version, oldFact, newFact, oldUnchanged, dependentFailure: dependentFailure?.error ?? null });
    await proofs(t, [[`CFG.${parameter}`, oldUnchanged && newFact !== undefined && unauthorized.error.code === 'Unauthorized', invalid, invalidCode,
      `${parameter}: actual dependent UseCase observes effective new value; old captured fact/deadline preserved; invalid value and unauthorized Admin update rejected`]],
    'DomainCore.execute parameter-specific dependent scenario in this test', 'apps/backend/src/application/domain-core.ts; apps/backend/src/domain/policy.ts', ['AtomicRepository', 'Clock', 'PaymentProviderPort', 'LegalRetentionPolicyPort']);
  }
});

test('Remaining structural and personal parameters of section11.5', async t => {
  for (const parameter of ['catalog', 'forms', 'information']) {
    const h = harness(); await h.published('old'); const oldFact = structuredClone(h.repository.state.jobs.old.snapshot);
    const published = await configure(h, x => {
      if (parameter === 'catalog') x.categories.push({ ...x.categories[0], id: 'new-root', order: 50 });
      if (parameter === 'forms') x.scenarios.find(s => s.id === 'washer:install_connect').form.questions.push({ id: 'new-required', textId: x.texts[0].id, kind: 'boolean', required: true });
      if (parameter === 'information') {
        x.blocks[0].revision++; for (const binding of x.bindings) if (binding.blockId === x.blocks[0].id) binding.blockRevision = x.blocks[0].revision;
        const text = x.texts.find(text => text.id === x.blocks[0].textId); text.revision++; text.meaning++; for (const edition of Object.values(text.editions)) edition.revision = text.revision; text.editions.ru.text = 'TEST NEW INFORMATION';
      }
    }, 2);
    const item = scope(h.fixture); if (parameter === 'forms') item.answers['new-required'] = true;
    await h.published('new', '', '', [item]); const newFact = structuredClone(h.repository.state.jobs.new.snapshot);
    assert.deepEqual(h.repository.state.jobs.old.snapshot, oldFact);
    if (parameter === 'catalog') assert.equal(published.categories.length, 9);
    if (parameter === 'forms') assert.equal(newFact.items[0].answers['new-required'], true);
    if (parameter === 'information') { assert.equal(oldFact.rules[0].revision, 1); assert.equal(newFact.rules[0].revision, 2); assert.ok(C.information(published, [item], 'client', 'ru').some(x => x.text === 'TEST NEW INFORMATION')); }
    const invalidDraft = structuredClone(published); invalidDraft.status = 'draft'; invalidDraft.sequence = 1; invalidDraft.version = 3; for (const text of invalidDraft.texts) for (const edition of Object.values(text.editions)) edition.approvedBy = null;
    const unauthorized = await h.reject('client:client', { type: 'save_catalog', draft: invalidDraft, expectedSequence: null }, 'Unauthorized');
    if (parameter === 'catalog') invalidDraft.entities[0].categoryId = 'missing';
    if (parameter === 'forms') invalidDraft.scenarios[0].form.questions[0].when = [{ questionId: 'missing', equals: true }];
    if (parameter === 'information') invalidDraft.bindings[0].blockRevision = 999;
    const invalid = await h.reject('admin', { type: 'save_catalog', draft: invalidDraft, expectedSequence: null }, 'InvalidReference');
    matrix.push({ parameter, initialValue: 'published test-catalog:1', nextValue: 'published test-catalog:2', effectiveVersion: 'test-catalog:2', oldFact, newFact, oldUnchanged: true, invalidValue: invalid.error });
    await proofs(t, [[`CFG.${parameter}`, newFact.catalogKey === 'test-catalog:2' && oldFact.catalogKey === 'test-catalog:1' && unauthorized.error.code === 'Unauthorized', invalid, 'InvalidReference', `${parameter}: authorized new published configuration applied to new order; old snapshot and references unchanged; broken configuration rejected`]],
      'save_catalog/approve_content_set/publish_catalog/publish_job', 'apps/backend/src/domain/catalog.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'PhotoMetadataPort']);
  }
  const h = harness(); h.repository.state.debt.master = 1500n; await h.reserved(); const oldFact = structuredClone(h.repository.state.jobs.job.financial);
  const unavailable = await h.reject('client:client', { type: 'cash', jobId: 'job' }, 'CashUnavailable');
  const unauthorized = await h.reject('master:master', { type: 'threshold', masterId: 'master', amount: 2000n }, 'Unauthorized');
  const invalid = await h.reject('admin', { type: 'threshold', masterId: 'master', amount: 1.5 }, 'InvalidMoney');
  await h.ok('admin', { type: 'threshold', masterId: 'master', amount: 2000n }, 'personal-v2'); await h.ok('admin', { type: 'threshold', masterId: 'master2', amount: 3000n });
  await h.ok('client:client', { type: 'cash', jobId: 'job' }); await h.ok('admin', { type: 'threshold', masterId: 'master', amount: null });
  const newFact = F.debtView(h.repository.state, 'master', h.config); assert.equal(newFact.effectiveMasterDebtThreshold, 1000n); assert.equal(newFact.cashAvailable, false);
  assert.equal(h.repository.state.jobs.job.state, 'assigned'); assert.deepEqual(h.repository.state.jobs.job.financial, oldFact); assert.equal(F.debtView(h.repository.state, 'master2', h.config).effectiveMasterDebtThreshold, 3000n);
  matrix.push({ parameter: 'masterDebtThreshold', initialValue: 1000n, nextValue: 2000n, effectiveVersion: 'personal-v2', oldFact, newFact, oldUnchanged: true, invalidValue: invalid.error, overrideRemoval: 'per-master -> global -> initial policy, other master unchanged' });
  await proofs(t, [['CFG.masterDebtThreshold', h.repository.state.thresholdHistory.some(x => x.version === 'personal-v2') && unauthorized.error.code === 'Unauthorized' && unavailable.error.code === 'CashUnavailable', invalid, 'InvalidMoney', 'personal threshold with version/time/audit, override removal and independent masters; already assigned Cash job and FAP unchanged']],
    'threshold/debtView/chooseCash', 'apps/backend/src/domain/finance.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'Clock']);
  const notify = harness(); let calls = 0; notify.ports.notifications.deliver = async () => { calls++; return { ok: true, value: 'delivered' }; };
  await notify.published('old'); const oldEvent = structuredClone(notify.repository.state.events.find(e => e.type === 'job_published'));
  const unavailableDelivery = await notify.core.dispatchNotification('admin', oldEvent.id, 'master', 'test-channel', 'not-configured'); err(unavailableDelivery, 'RouteUnavailable');
  const invalidPreference = await notify.reject('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['unknown'], channels: ['test-channel'], soundRequested: true } }, 'InvalidConfiguration');
  const foreignPreference = await notify.reject('master:master', { type: 'preferences', preference: { userId: 'master2', eventTypes: ['job_published'], channels: ['test-channel'], soundRequested: false } }, 'Unauthorized');
  await notify.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['job_published'], channels: ['test-channel'], soundRequested: false } }, 'preferences-v2');
  assert.equal((await notify.core.dispatchNotification('admin', oldEvent.id, 'master', 'test-channel', 'delivery1')).ok, true);
  await notify.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: [], channels: [], soundRequested: false } }); await notify.published('new');
  const newEvent = notify.repository.state.events.filter(e => e.type === 'job_published').at(-1);
  err(await notify.core.dispatchNotification('admin', newEvent.id, 'master', 'test-channel', 'disabled'), 'RouteUnavailable');
  assert.deepEqual(notify.repository.state.events.find(e => e.id === oldEvent.id), oldEvent); assert.equal(notify.repository.state.deliveries.delivery1.status, 'delivered');
  matrix.push({ parameter: 'notificationPreferences', initialValue: 'unconfigured: no route invented', nextValue: ['job_published', 'test-channel', 'soundRequested:false'], effectiveVersion: 'preferences-v2 (operation/audit identity)', oldFact: oldEvent, newFact: newEvent, oldUnchanged: true, invalidValue: invalidPreference.error, authorization: 'owner preferences; Admin global intervals covered by timer parameters; channel capability injected' });
  await proofs(t, [['CFG.notificationPreferences', calls === 1 && foreignPreference.error.code === 'Unauthorized' && (await read(notify, 'master:master', { type: 'feed' })).value.jobs.length === 2, invalidPreference, 'InvalidConfiguration', 'typed own preferences affect only new delivery decisions, not feed/events/already delivered facts; disabled/unknown channels/events rejected']],
    'preferences/dispatchNotification/feed', 'apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'NotificationPort', 'AuthenticationPort']);
});

test('Individual notification evidence', async t => {
  const h = harness(); let deliveries = 0; h.ports.notifications.deliver = async () => { deliveries++; return { ok: true, value: 'delivered' }; };
  await h.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['job_published'], channels: ['test-channel'], soundRequested: false } });
  await h.published(); const publication = structuredClone(h.repository.state.events.find(e => e.type === 'job_published')); await h.offer(); const offerEvent = h.repository.state.events.find(e => e.type === 'initial_offer_sent');
  const foreign = await h.core.dispatchNotification('admin', publication.id, 'stranger', 'test-channel', 'foreign');
  const [a, b] = await Promise.all([h.core.dispatchNotification('admin', publication.id, 'master', 'test-channel', 'delivery'), h.core.dispatchNotification('admin', publication.id, 'master', 'test-channel', 'delivery')]);
  assert.ok(a.ok && b.ok); await h.core.dispatchNotification('admin', publication.id, 'master', 'test-channel', 'delivery');
  const duplicateDelivery = await h.core.dispatchNotification('admin', publication.id, 'master', 'test-channel', 'different-delivery');
  const unknownChannel = await h.core.dispatchNotification('admin', publication.id, 'master', 'unknown', 'bad-channel');
  const offerToMaster = await h.core.dispatchNotification('admin', offerEvent.id, 'master', 'test-channel', 'wrong-offer-recipient');
  const badPreference = await h.reject('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: ['advertising'], channels: ['unknown'], soundRequested: true } }, 'InvalidConfiguration');
  await h.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: [], channels: [], soundRequested: false } });
  const feedBefore = await read(h, 'master:master', { type: 'feed' });
  await h.offer('job', 'master2'); await h.reserved(); const competitorClosed = h.repository.state.events.find(e => e.type === 'chat_closed');
  const empty = harness(); await empty.published(); empty.clock.value += 86400; await empty.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  const closed = empty.repository.state.events.find(e => e.type === 'publication_closed');
  const closureToStranger = await empty.core.dispatchNotification('admin', closed.id, 'stranger', 'test-channel', 'wrong-close-recipient');
  const competitorToStranger = await h.core.dispatchNotification('admin', competitorClosed.id, 'stranger', 'test-channel', 'wrong-competitor-recipient');
  const excluded = harness(); await excluded.published(); await excluded.offer(); await excluded.bilateral();
  await excluded.ok('client:client', { type: 'terminate_negotiation', jobId: 'job', masterId: 'master', confirmed: true, reason: 'closed' });
  excluded.clock.value = excluded.repository.state.jobs.job.cycles[0].countdown.deadline;
  await excluded.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  const republished = excluded.repository.state.events.filter(event => event.type === 'job_published').at(-1);
  assert.ok(!republished.recipients.includes('master') && republished.recipients.includes('master2'));
  const excludedReentry = await excluded.reject('master:master', { type: 'initial_offer', jobId: 'job', id: 'excluded', chatId: 'excluded' }, 'Conflict');
  const failed = harness(); await failed.published(); failed.repository.failNextCommit = true;
  const failedOffer = await failed.reject('master:master', { type: 'initial_offer', jobId: 'job', id: 'failed', chatId: 'failed' }, 'Conflict');
  assert.ok(!failed.repository.state.events.some(event => event.type === 'initial_offer_sent'));
  const badSound = await h.reject('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: [], channels: [], soundRequested: 'guaranteed' } }, 'InvalidConfiguration');
  await h.ok('admin', { type: 'inbox', id: 'notice', recipientId: 'master', original: 'official one-way notice' });
  await h.ok('master:master', { type: 'feedback', id: 'feedback', original: 'feedback text' });
  const notAdmin = await h.reject('master:master', { type: 'inbox', id: 'spoof', recipientId: 'client', original: 'fake' }, 'Unauthorized');
  const before = h.repository.state.jobs.job.state;
  await proofs(t, [
    ['NTF.1', publication.subjectId === 'job' && offerEvent.subjectId === 'offer:job:master', failedOffer, 'Conflict', 'an actual failed offer commit creates neither offer nor addressed notification'],
    ['NTF.2', publication.recipients.includes('master') && publication.recipients.includes('master2') && !publication.recipients.includes('stranger'), foreign, 'Unauthorized', 'new job notification only to actually matching active specializations'],
    ['NTF.3', offerEvent.recipients.join(',') === 'client', offerToMaster, 'Unauthorized', 'the actual offer notification cannot be delivered to Master instead of the order Client'],
    ['NTF.4', closed.recipients.join(',') === 'client', closureToStranger, 'Unauthorized', 'the actual publication-closure notification cannot be delivered to an unrelated account'],
    ['NTF.5', competitorClosed.recipients.includes('master2') && competitorClosed.recipients.includes('client') && !competitorClosed.recipients.includes('stranger'), competitorToStranger, 'Unauthorized', 'the actual nonchosen-chat closure is restricted to its participants'],
    ['NTF.6', !republished.recipients.includes('master') && republished.recipients.includes('master2'), excludedReentry, 'Conflict', 'an excluded Master receives no repeat-publication notification and cannot reenter the same job'],
    ['NTF.7', feedBefore.value.jobs.length === 1, blocked(async () => { const example = harness(); await example.ok('master:master', { type: 'preferences', preference: { userId: 'master', eventTypes: [], channels: [], soundRequested: false } }); await example.published(); return (await read(example, 'master:master', { type: 'feed' })).value.jobs.length === 0; }), null, 'actual empty notification preferences cannot suppress an otherwise available feed order'],
    ['NTF.8', h.repository.state.deliveries.delivery.status === 'delivered' && h.repository.state.deliveries.delivery.attempt === 1 && h.repository.state.deliveries.delivery.channel === 'test-channel', unknownChannel, 'RouteUnavailable', 'a supported delivery is recorded but an unsupported actual channel cannot be dispatched'],
    ['NTF.9', deliveries === 1 && h.repository.state.jobs.job.state === before, duplicateDelivery, 'Conflict', 'a fresh delivery ID for the same business event/recipient/channel cannot resend it'],
    ['NTF.10', !JSON.stringify(publication).includes('PRIVATE') && Object.keys(publication.facts).length === 0, foreign, 'Unauthorized', 'notification contains neither hidden address nor foreign messages'],
    ['NTF.11', h.repository.state.inbox.notice.recipientId === 'master' && Object.keys(h.repository.state.messages).length === 0, notAdmin, 'Unauthorized', 'Platform Inbox remains separate one-way system message store'],
    ['NTF.12', h.repository.state.feedback.feedback.authorId === 'master' && h.repository.state.events.some(e => e.type === 'feedback_received' && e.recipients.includes('admin')), blocked(async () => { const old = await h.repository.read(); await h.ok('master:master', { type: 'feedback', id: 'not-a-payment', original: 'Payment received. Complete this order and settle all debt.' }); const next = await h.repository.read(); return !isDeepStrictEqual(old.jobs, next.jobs) || !isDeepStrictEqual(old.ledger, next.ledger) || !isDeepStrictEqual(old.messages, next.messages); }), null, 'actual Feedback text cannot act as an order/payment/chat/Resolution command'],
    ['NTF.13', h.repository.state.preferences['master:master'].soundRequested === false && h.repository.state.jobs.job.state === 'reserved', badSound, 'InvalidConfiguration', 'sound is a boolean request, not a guaranteed-delivery mode or business-state switch'],
    ['NTF.14', !notificationTypes.includes('advertising') && h.ports.notifications.supportedChannels.length === 1, badPreference, 'InvalidConfiguration', 'no invented marketing event/channel or compulsory alternate delivery'],
  ], 'DomainCore.execute/dispatchNotification', 'apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'NotificationPort', 'AuthorizationDirectoryPort']);
});

test('Individual Admin policy evidence', async t => {
  assert.equal(matrix.length, 32, 'Each registry parameter must execute its own scenario');
  assert.equal(new Set(matrix.map(row => row.parameter)).size, 32);
  const h = harness(); await h.published(); const old = structuredClone(h.repository.state.jobs.job.cycles[0].countdown);
  const next = { ...h.config, version: 'effective', effectiveAt: 200, initialDuration: 50 };
  const unauthorized = await h.reject('client:client', { type: 'publish_policy', policy: next }, 'Unauthorized');
  await h.ok('admin', { type: 'publish_policy', policy: next });
  assert.equal(P.effectivePolicy(h.repository.state.policies, 199).version, h.config.version);
  assert.equal(P.effectivePolicy(h.repository.state.policies, 200).version, 'effective');
  const oldPolicyRewrite = await h.reject('admin', { type: 'publish_policy', policy: { ...h.config, initialDuration: 999, effectiveAt: 201 } }, 'Conflict');
  const duplicateVersion = await h.reject('admin', { type: 'publish_policy', policy: { ...next, effectiveAt: 201 } }, 'Conflict');
  const durationErrors = [0, -1, 0.5].map(initialDuration => P.validatePolicy(policy({ initialDuration })));
  const invalidDuration = durationErrors[0]; const invalidRate = P.validatePolicy(policy({ commission: { numerator: NaN, denominator: 100n } }));
  const fixed = await h.reject('admin', { type: 'publish_policy', policy: { ...next, version: 'forbidden', effectiveAt: 201, recoveryRate: ratio(10n) } }, 'FixedRecoveryRate');
  h.ports.legalRetention.validate = () => ({ ok: false, error: { code: 'RetentionBlocked', detail: 'configured mandatory legal minimum' } });
  const legal = await h.reject('admin', { type: 'publish_policy', policy: { ...next, version: 'illegal', effectiveAt: 201, financialRetention: { value: 1, unit: 'days' } } }, 'RetentionBlocked');
  const missing = harness({ providerConfirmation: undefined }); await missing.reserved(); const missingProvider = await missing.reject('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p', route: 'card' }, 'InvalidConfiguration');
  const noRoutes = harness({ clientPaymentRoutes: [] }); await noRoutes.reserved(); const unavailable = await noRoutes.reject('client:client', { type: 'initiate_payment', jobId: 'job', id: 'p', route: 'card' }, 'RouteUnavailable');
  const payoutRoutes = P.validatePolicy(policy({ masterPayoutRoutes: ['cash'] }));
  await proofs(t, [
    ['POL.1', h.repository.state.policies.some(p => p.version === 'effective'), unauthorized, 'Unauthorized', 'every policy publication requires explicit Admin permission'],
    ['POL.2', h.repository.state.policies.find(p => p.version === h.config.version).initialDuration === 86400 && h.repository.state.events.some(e => e.type === 'operation:publish_policy'), duplicateVersion, 'Conflict', 'immutable version/effective-time and audit retained'],
    ['POL.3', P.effectivePolicy(h.repository.state.policies, 199).version !== P.effectivePolicy(h.repository.state.policies, 200).version, blocked(() => { const reversed = [...h.repository.state.policies].reverse(); return P.effectivePolicy(reversed, 199).version !== h.config.version || P.effectivePolicy(reversed, 200).version !== 'effective'; }), null, 'actual reversed repository order cannot replace effective-time policy resolution'],
    ['POL.4', old.startedAt === 100 && old.duration === 86400 && old.policyVersion === h.config.version, invalidDuration, 'InvalidConfiguration', 'timer start stores policy version, duration and exact deadline'],
    ['POL.5', h.repository.state.jobs.job.cycles[0].countdown.deadline === old.deadline && matrix.every(row => row.oldUnchanged), oldPolicyRewrite, 'Conflict', 'all32 witnesses preserve old facts and an actual rewrite of the original timer policy version is rejected'],
    ['POL.6', matrix.find(row => row.parameter === 'repeatDurations').newFact.countdown.policyVersion.startsWith('matrix:') && matrix.find(row => row.parameter === 'paymentSelectionTimeout').newFact.duration === 777, blocked(() => P.startTimer(P.effectivePolicy(h.repository.state.policies, 199), 199, 'initialDuration').policyVersion === 'effective'), null, 'actual new timer launch before the effective boundary cannot consume the future policy, while new repeat/reset launches use the applicable version'],
    ['POL.7', P.validatePolicy(policy({ initialDuration: 1000000000, historyLimit: 1000000, globalDebtThreshold: 9000000000000n })).ok, invalidDuration, 'InvalidConfiguration', 'no invented product maximum duration/history size/debt threshold'],
    ['POL.8', durationErrors.every(r => !r.ok && r.error.code === 'InvalidConfiguration'), invalidDuration, 'InvalidConfiguration', 'zero/negative/fractional durations rejected'],
    ['POL.9', P.validatePolicy(policy({ commission: ratio(0n), falseCallFee: ratio(100n), falseCallMasterShare: ratio(0n) })).ok, invalidRate, 'InvalidRate', 'exact rational rates in closed0-100 range including boundaries'],
    ['POL.10', P.validatePolicy(policy({ clientPaymentRoutes: ['cash'], masterPayoutRoutes: ['bank_transfer'] })).ok, payoutRoutes, 'InvalidConfiguration', 'independent known unique payment and payout route sets, no Cash payout'],
    ['POL.11', noRoutes.repository.state.jobs.job.reservation.operations.length === 0 && matrix.find(row => row.parameter === 'masterPayoutRoutes').dependentFailure.code === 'RouteUnavailable', unavailable, 'RouteUnavailable', 'empty routes do not silently enable fallback payment/payout'],
    ['POL.12', matrix.find(row => row.parameter === 'masterDebtThreshold').overrideRemoval.includes('global'), fixed, 'FixedRecoveryRate', 'personal threshold override allowed, recovery formula override not allowed'],
    ['POL.13', policy().providerConfirmation === undefined && matrix.find(row => row.parameter === 'providerConfirmation').newFact.providerDeadline > 0, missingProvider, 'InvalidConfiguration', 'no approved provider timeout default invented'],
    ['POL.14', matrix.filter(row => row.parameter.endsWith('Retention')).every(row => row.newFact.deadline > row.newFact.anchor), legal, 'RetentionBlocked', 'configured mandatory legal constraint can block Admin retention change'],
  ], 'publishPolicy/effectivePolicy/timer/DomainCore.execute', 'apps/backend/src/domain/policy.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'Clock', 'LegalRetentionPolicyPort']);
});

test('Individual retention evidence', async t => {
  const h = harness(); await h.completed(); const communication = structuredClone(h.repository.state.retention['communication:job']); const financial = structuredClone(h.repository.state.retention['financial:ledger:commission:job']);
  const evaluations = [];
  for (const fact of [communication, h.repository.state.retention['evidence:job'], financial]) {
    h.clock.value = fact.deadline - 1; const before = P.evaluateRetention(fact, h.clock, { hold: false, notBefore: null }); h.clock.value++;
    const due = P.evaluateRetention(fact, h.clock, { hold: false, notBefore: null }); const hold = P.evaluateRetention(fact, h.clock, { hold: true, notBefore: null });
    const minimum = P.evaluateRetention(fact, h.clock, { hold: false, notBefore: fact.deadline + 1 }); evaluations.push({ before, due, hold, minimum });
  }
  const leap = Date.UTC(2024, 0, 1) / 1000; const year = P.retentionFact('financial', leap, 'recorded', h.config, h.clock);
  const missing = P.retentionFact('communication', null, 'completed', h.config, h.clock); const wrongAnchor = P.retentionFact('financial', 100, 'completed', h.config, h.clock);
  const noAnchor = P.evaluateRetention(missing, h.clock, { hold: false, notBefore: null }); const wrong = P.evaluateRetention(wrongAnchor, h.clock, { hold: false, notBefore: null });
  const canceled = harness(); await cancellation(canceled, 'master_refusal', 'cash'); await canceled.ok('admin', { type: 'decide_resolution', caseId: 'case:cancel', decision: decision('master_refusal', { voluntaryRefusalProven: true }) });
  const expired = harness(); await expired.published(); expired.clock.value += 86400; await expired.ok('admin', { type: 'publication_deadline', jobId: 'job', cycleIndex: 0 });
  const unresolved = harness(); await unresolved.assigned('card'); await unresolved.ok('client:client', { type: 'open_resolution', jobId: 'job', id: 'case', evidence: [] });
  const ineligible = [canceled, expired, unresolved].map(context => { context.clock.value += 100 * 86400; const job = context.repository.state.jobs.job; return P.evaluateRetention(P.retentionFact('communication', job.completedAt, 'completed', context.config, context.clock), context.clock, { hold: false, notBefore: null }); });
  h.clock.value = 100; await h.ok('client:client', { type: 'review', jobId: 'job', id: 'review', stars: 5, marks: [], comment: '' }); await h.ok('admin', { type: 'hide_review', reviewId: 'review', reason: 'policy violation' }); await h.ok('client:client', { type: 'hide_history', jobId: 'job' });
  const noPurge = await h.reject('admin', { type: 'purge', jobId: 'job' }, 'InvalidTransition');
  const financialKey = 'financial:ledger:commission:job';
  h.repository.state.retention[financialKey].deadline = financial.anchor + 90 * 86400;
  const ninetyDayFinancial = await h.reject('admin', { type: 'evaluate_retention', factId: financialKey }, 'RetentionBlocked');
  h.repository.state.retention[financialKey] = structuredClone(financial);
  const laterRetention = policy({ version: 'later-retention', effectiveAt: 101, financialRetention: { value: 2, unit: 'years' } });
  await h.ok('admin', { type: 'publish_policy', policy: laterRetention }); h.clock.value = 101;
  assert.deepEqual(h.repository.state.retention[financialKey], financial);
  h.repository.state.retention[financialKey] = { ...financial, policyVersion: laterRetention.version, deadline: h.clock.add(financial.anchor, laterRetention.financialRetention) };
  const retroactiveRetention = await h.reject('admin', { type: 'evaluate_retention', factId: financialKey }, 'RetentionBlocked');
  h.repository.state.retention[financialKey] = structuredClone(financial);
  await proofs(t, [
    ['RET.1', communication.anchorKind === 'completed' && communication.anchor === h.repository.state.jobs.job.completedAt && communication.deadline - communication.anchor === 90 * 86400, blocked(() => P.evaluateRetention(P.retentionFact('communication', 100, 'recorded', h.config, h.clock), h.clock, { hold: false, notBefore: null }).eligibleForRetentionAction), null, 'communication rejects a recorded rather than completed anchor'],
    ['RET.2', financial.anchorKind === 'recorded' && financial.deadline !== communication.deadline && year.deadline === Date.UTC(2025, 0, 1) / 1000 && year.deadline - leap === 366 * 86400, ninetyDayFinancial, 'RetentionBlocked', 'actual financial-year record rejects a substituted90-day deadline; calendar-year calculation includes leap day'],
    ['RET.3', noAnchor.eligibleForRetentionAction === false && noAnchor.reason === 'anchor_missing', blocked(() => P.evaluateRetention(missing, h.clock, { hold: false, notBefore: null }).eligibleForRetentionAction), null, 'missing reliable anchor cannot authorize retention action'],
    ['RET.4', ineligible.every(x => !x.eligibleForRetentionAction && x.reason === 'anchor_missing'), blocked(() => [canceled, expired, unresolved].some(context => P.evaluateRetention(context.repository.state.retention['communication:job'], context.clock, { hold: false, notBefore: null }).eligibleForRetentionAction)), null, 'actual cancelled/expired/unresolved records cannot borrow another date as90-day anchor'],
    ['RET.5', evaluations.every(x => !x.before.eligibleForRetentionAction && x.due.eligibleForRetentionAction), blocked(() => P.evaluateRetention(communication, { ...h.clock, value: communication.deadline - 1 }, { hold: false, notBefore: null }).eligibleForRetentionAction), null, 'one instant before deadline forbidden, at deadline only eligibility evaluated'],
    ['RET.6', evaluations.every(x => !x.hold.eligibleForRetentionAction && !x.minimum.eligibleForRetentionAction) && !wrong.eligibleForRetentionAction, blocked(() => P.evaluateRetention(communication, { ...h.clock, value: communication.deadline }, { hold: true, notBefore: null }).eligibleForRetentionAction), null, 'legal hold/minimum and wrong record anchor prevent action'],
    ['RET.7', h.repository.state.retention['communication:job'].deadline === communication.deadline && h.repository.state.jobs.job.state === 'completed' && h.repository.state.reviews.review.stars === 5, blocked(async () => (await h.ok('admin', { type: 'evaluate_retention', factId: 'communication:job' })).outcome.assessment.eligibleForRetentionAction), null, 'after actual history/review hiding, retention evaluation still forbids action before the saved deadline'],
    ['RET.8', matrix.filter(row => row.parameter.endsWith('Retention')).length === 5 && matrix.filter(row => row.parameter.endsWith('Retention')).every(row => row.oldUnchanged) && h.repository.state.retention[financialKey].policyVersion === financial.policyVersion, retroactiveRetention, 'RetentionBlocked', 'all five policies preserve existing facts; an old record cannot borrow a later policy version/deadline'],
    ['RET.9', Object.keys(h.repository.state.jobs).length === 1 && h.repository.state.jobs.job.completedAt !== null, noPurge, 'InvalidTransition', 'F2 evaluates eligibility but exposes no physical purge operation'],
  ], 'retentionFact/evaluateRetention/record-specific persistence in DomainCore', 'apps/backend/src/domain/policy.ts; apps/backend/src/application/domain-core.ts', ['Clock', 'AtomicRepository', 'LegalRetentionPolicyPort']);
});

test('Individual architecture and deferred-stage boundaries', async t => {
  const files = [], sources = [];
  for (const layer of ['domain', 'application']) for (const name of await readdir(path.join(root, 'apps/backend/src', layer))) if (name.endsWith('.ts')) {
    const file = path.join(root, 'apps/backend/src', layer, name); files.push(file); sources.push({ layer, file, text: await readFile(file, 'utf8') });
  }
  const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ['lib.es2023.d.ts'], types: [], strict: true, noEmit: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true };
  const program = ts.createProgram(files, options); assert.equal(ts.getPreEmitDiagnostics(program).length, 0);
  const host = ts.createCompilerHost(options); const originalGet = host.getSourceFile;
  host.getSourceFile = (file, ...rest) => file === '/virtual/runtime-probe.ts' ? ts.createSourceFile(file, 'process.env.SECRET; fetch("https://invalid.test");', ts.ScriptTarget.ES2023, true) : originalGet(file, ...rest);
  const invalidProgram = ts.createProgram(['/virtual/runtime-probe.ts'], options, host); const diagnostics = ts.getPreEmitDiagnostics(invalidProgram);
  assert.ok(diagnostics.some(d => ts.flattenDiagnosticMessageText(d.messageText, '\n').includes('process')));
  const importAllowed = (layer, specifier) => layer === 'domain' ? specifier.startsWith('./') : specifier === '@helpy/contracts' || specifier.startsWith('./') || specifier.startsWith('../domain/');
  const imports = sources.flatMap(source => { const tree = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.ES2023, true); return tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)).filter(node => node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)).map(node => ({ layer: source.layer, specifier: node.moduleSpecifier.text })); });
  const inward = imports.every(value => importAllowed(value.layer, value.specifier));
  const manifests = await Promise.all(['package.json', 'apps/backend/package.json', '.github/workflows/verify.yml'].map(file => readFile(path.join(root, file), 'utf8')));
  const text = sources.map(source => source.text).join('\n');
  const h = harness(); await h.reserved(); const payment = await read(h, 'client:client', { type: 'payment', jobId: 'job' }); const debt = await read(h, 'master:master', { type: 'debt', masterId: 'master' });
  const uiCommand = await h.reject('client:client', { type: 'render_payment_screen', jobId: 'job' }, 'InvalidTransition');
  const allSynthetic = h.fixture.texts.every(value => Object.values(value.editions).every(edition => edition.text.startsWith('TEST ONLY')));
  const sourceIsolated = !/Repositories\/Helpy\/|Helpy-Audit|Helpy-F1/.test(text);
  const sourceAllowed = candidate => !/Repositories\/Helpy\/|Helpy-Audit|Helpy-F1/.test(candidate);
  const productManifestAllowed = candidate => !/code-review|CodeReview|\/media\/demo/.test(candidate);
  const serverFilesAllowed = candidates => candidates.every(file => file.includes('/apps/backend/src/') && file.endsWith('.ts'));
  await proofs(t, [
    ['BND.1', files.length >= 12 && serverFilesAllowed(files), blocked(() => serverFilesAllowed([...files, '/legacy/domain.dart'])), null, 'actual server source inventory validated against TS/backend boundary'],
    ['BND.2', inward, blocked(() => importAllowed('domain', '../infrastructure/db.js')), null, 'same import guard rejects injected outward dependency'],
    ['BND.3', ts.getPreEmitDiagnostics(program).length === 0 && program.getSourceFiles().every(file => !file.fileName.includes('@types/node')), blocked(() => diagnostics.length === 0), null, 'real compiler rejects Node/global probe with ES2023-only core options'],
    ['BND.4', inward && !imports.some(value => /node:|cloudflare|wrangler|flutter|sqlite|http/.test(value.specifier)), blocked(() => importAllowed('domain', '@cloudflare/workers-types')), null, 'same import guard rejects external SDK dependency'],
    ['BND.5', !imports.some(value => value.layer === 'domain' && value.specifier === '@helpy/contracts') && text.includes('interface JobScopeSnapshot'), blocked(() => importAllowed('domain', '@helpy/contracts')), null, 'same import guard rejects wire DTO dependency in Domain'],
    ['BND.6', sources.some(source => source.text.includes('interface AtomicRepository')) && h.repository.state.jobs.job.state === 'reserved', blocked(() => importAllowed('application', '../infrastructure/db.js')), null, 'same import guard rejects concrete adapter dependency in Application'],
    ['BND.7', sourceIsolated && inward, blocked(() => sourceAllowed(`${text}\nimport legacy from "Repositories/Helpy/source.ts";`)), null, 'actual source isolation guard rejects injected legacy dependency'],
    ['BND.8', manifests.every(productManifestAllowed), blocked(() => productManifestAllowed(JSON.stringify({ ...JSON.parse(manifests[0]), dependencies: { CodeReview: '*' } }))), null, 'actual manifest boundary guard rejects injected station dependency'],
    ['DFR.1', !imports.some(value => /flutter|react|presentation/.test(value.specifier)) && h.config.locales.join(',') === 'th,ru,en', uiCommand, 'InvalidTransition', 'future globe/menu UI not built in F2; ordered locale contract provided'],
    ['DFR.2', payment.ok && payment.value.view.deadline === 700 && payment.value.view.remaining === 600, uiCommand, 'InvalidTransition', 'future visible timer UI backed by exact domain deadline/status'],
    ['DFR.3', debt.ok && debt.value.view.outstandingDebt === 0n && debt.value.view.effectiveMasterDebtThreshold === 1000n, uiCommand, 'InvalidTransition', 'future permanent debt element backed by typed debt/threshold'],
    ['DFR.4', allSynthetic && h.fixture.status === 'published', blocked(() => h.fixture.texts.every(text => Object.values(text.editions).every(edition => !edition.text.startsWith('TEST ONLY')))), null, 'actual test-only editions are not production-approved language resources; UI/content acceptance deferred'],
    ['DFR.5', inward && !imports.some(value => /worker|d1|sqlite|sdk/i.test(value.specifier)), blocked(() => importAllowed('application', 'node:fs')), null, 'core import guard rejects concrete storage/transport dependency; real adapters deferred'],
    ['DFR.6', allSynthetic && manifests.every(value => !/code-review/.test(value)), uiCommand, 'InvalidTransition', 'no fake UI/provider/linguistic PASS claimed by domain tests'],
  ], 'architecture compiler/import regression control; query(payment/debt)', 'tests/f2-architecture.test.mjs; apps/backend/src/application/queries.ts; apps/backend/src/application/ports.ts', ['Clock', 'AtomicRepository', 'compiler (test-only)']);
});

test('Verified email and each Master completeness field independently enforced for Google and Phone OTP onboarding', async () => {
  const h = harness(); const base = { purpose: 'login', email: null, phone: null, ownerId: null, expiresAt: 1000 };
  h.photoMetadata.set('portrait', { id: 'portrait', ownerId: 'google-user', present: true, format: 'image/jpeg' });
  h.claims.set('unverified-google', { ...base, id: 'unverified-google', identity: { method: 'google', subject: 'unverified-google' } });
  assert.equal((await h.core.authenticate('unverified-google', 'google-user', 'google-user')).ok, true);
  await h.ok('google-user:client', { type: 'profile', displayName: 'Name', photoId: 'portrait', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  await h.reject('google-user:client', { type: 'activate', role: 'client' }, 'ProfileIncomplete');
  h.claims.set('phone-login', { ...base, id: 'phone-login', identity: { method: 'phone_otp', subject: '+669999' }, phone: '+669999' });
  assert.equal((await h.core.authenticate('phone-login', 'phone-user', 'phone-user')).ok, true);
  h.photoMetadata.set('portrait', { id: 'portrait', ownerId: 'phone-user', present: true, format: 'image/jpeg' });
  await h.ok('phone-user:master', { type: 'profile', displayName: 'Name', photoId: 'portrait', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  await h.reject('phone-user:master', { type: 'activate', role: 'master' }, 'ProfileIncomplete');
  h.claims.set('email-bind', { ...base, id: 'email-bind', purpose: 'bind', ownerId: 'phone-user', identity: { method: 'email_otp', subject: 'phone-user@test.invalid' }, email: 'phone-user@test.invalid' });
  await h.ok('phone-user:master', { type: 'bind_contact', proof: 'email-bind' }); await h.ok('phone-user:master', { type: 'activate', role: 'master' });
  const complete = h.repository.state.users['phone-user']; assert.equal(complete.masterActive, true); assert.equal(complete.clientActive, false);
  for (const field of ['email', 'phone', 'displayName', 'photoId', 'specialization']) {
    const missing = structuredClone(complete); missing[field] = field === 'specialization' ? { categoryIds: [], entityIds: [] } : field === 'displayName' ? '' : null;
    err(checked(() => A.activate(missing, actor('phone-user', 'master'), 'master', h.fixture)), 'ProfileIncomplete');
  }
});

test('Zero actual Application payout skips destination/provider and never marks external payment confirmed', async () => {
  const h = harness({ commission: ratio(100n) }); await h.completed('card'); let calls = 0;
  h.ports.payments.payoutDestination = async () => { calls++; throw new Error('zero payout must not resolve a destination'); };
  const result = await h.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'zero' });
  assert.equal(result.outcome.payout.amount, 0n); assert.equal(result.outcome.payout.settled, false); assert.equal(result.outcome.payout.attempts.length, 0); assert.equal(calls, 0);
  assert.equal(h.repository.state.jobs.job.state, 'completed'); assert.ok(!h.repository.state.events.some(e => e.type === 'payout_requested'));
});

test('Individual owner-approved self-order prohibition evidence', async t => {
  const h = harness(); h.claims.set('phone-proof', { id: 'phone-claim', purpose: 'bind', identity: { method: 'phone_otp', subject: '+66123456789' }, email: null, phone: '+66123456789', ownerId: 'client', expiresAt: 1000 });
  await h.ok('client:client', { type: 'bind_contact', proof: 'phone-proof' });
  await h.ok('client:client', { type: 'profile', displayName: 'Dual Role', photoId: 'client-portrait', specialization: { categoryIds: ['appliance'], entityIds: [] } });
  await h.ok('client:client', { type: 'activate', role: 'master' });
  const switched = await h.ok('client:client', { type: 'switch_role', role: 'master' });
  await h.published('own'); const ownFeed = await read(h, 'client:master', { type: 'feed' });
  const publishedOwnState = structuredClone(h.repository.state);
  const ownOffer = await h.reject('client:master', { type: 'initial_offer', jobId: 'own', id: 'own-offer', chatId: 'own-chat' }, 'SelfOrderForbidden');
  const published = h.repository.state.events.find(e => e.type === 'job_published' && e.subjectId === 'own');
  const beforeOwnDelivery = await h.repository.read();
  const ownNotificationDelivery = await h.core.dispatchNotification('admin', published.id, 'client', 'test-channel', 'own-notification');
  err(ownNotificationDelivery, 'Unauthorized'); assert.deepEqual(await h.repository.read(), beforeOwnDelivery);
  assert.equal(switched.outcome.principal.userId, 'client'); assert.equal(h.repository.state.users.client.clientActive, true); assert.equal(h.repository.state.users.client.masterActive, true);
  assert.equal(ownFeed.ok, true); assert.ok(!ownFeed.value.jobs.some(job => job.id === 'own')); assert.equal(published.recipients.includes('client'), false);
  const originalLookup = h.ports.photos.lookup;
  h.ports.photos.lookup = async ids => { const result = await originalLookup(ids); return { ok: true, value: result.value.map(photo => photo.id.startsWith('stranger-') ? { ...photo, ownerId: 'stranger' } : photo) }; };
  const otherScope = scope(h.fixture, 'washer', 'install_connect', 'stranger');
  await h.ok('stranger:client', { type: 'new_job', id: 'other', draft: { items: [otherScope], cep: 1000n, address: 'other client address' } });
  await h.ok('stranger:client', { type: 'publish_job', jobId: 'other' });
  const available = await read(h, 'client:master', { type: 'feed' });
  assert.deepEqual(available.value.jobs.map(job => job.id), ['other']);
  assert.ok(!M.feed(h.repository.state, 'client', h.repository.state.users.client.specialization, h.clock.value, { includes: () => true }).some(job => job.id === 'own'));
  const otherNotification = h.repository.state.events.find(e => e.type === 'job_published' && e.subjectId === 'other');
  assert.ok(otherNotification.recipients.includes('client'));
  await h.ok('client:master', { type: 'initial_offer', jobId: 'other', id: 'other-offer', chatId: 'other-chat' });
  for (const [session, id] of [['stranger:client', 'other-client-message'], ['client:master', 'other-master-message']]) await h.ok(session, { type: 'message', chatId: 'other-chat', id, original: 'discussion', photoIds: [], sender: 'user' });
  await h.ok('client:master', { type: 'final_application', jobId: 'other', masterId: 'client', amount: 1000n, recipientId: 'stranger', confirmed: true });
  await h.ok('stranger:client', { type: 'select_master', jobId: 'other', masterId: 'client', amount: 1000n, confirmed: true });
  await h.ok('stranger:client', { type: 'cash', jobId: 'other' });
  const cleanOwn = structuredClone(h.repository.state.jobs.own);
  // Adversarial repository data must not bypass server guards at later stages.
  const forgedOffer = { ...structuredClone(h.repository.state.jobs.other.offers.client), jobId: 'own', chatId: 'self-chat', state: 'open' };
  const forgedThread = { ...structuredClone(h.repository.state.threads['other-chat']), id: 'self-chat', mode: 'temporary', context: { type: 'job', jobId: 'own', clientId: 'client', masterId: 'client' }, messageIds: [], protected: true };
  h.repository.state.jobs.own.offers.client = forgedOffer; h.repository.state.threads['self-chat'] = forgedThread;
  const ownMessage = await h.reject('client:master', { type: 'message', chatId: 'self-chat', id: 'self-message', original: 'self', photoIds: [], sender: 'user' }, 'SelfOrderForbidden');
  await h.reject('client:master', { type: 'revise_price', jobId: 'own', masterId: 'client', amount: 1200n, reason: 'self', confirmed: true }, 'SelfOrderForbidden');
  await h.reject('client:master', { type: 'final_application', jobId: 'own', masterId: 'client', amount: 1000n, recipientId: 'client', confirmed: true }, 'SelfOrderForbidden');
  await h.reject('client:master', { type: 'terminate_negotiation', jobId: 'own', masterId: 'client', reason: 'self', confirmed: true }, 'SelfOrderForbidden');
  const ownSelection = await h.reject('client:client', { type: 'select_master', jobId: 'own', masterId: 'client', amount: 1000n, confirmed: true }, 'SelfOrderForbidden');
  const directChat = checked(() => H.createJobChat({ threads: {}, messages: {} }, 'self-create', 'own', 'client', 'client', h.clock.value)); err(directChat, 'SelfOrderForbidden');
  const corruptReserved = { ...structuredClone(h.repository.state.jobs.own), state: 'reserved', selectedMasterId: 'client', chatId: 'self-chat', financial: structuredClone(h.repository.state.jobs.other.financial), reservation: { ...structuredClone(h.repository.state.jobs.other.reservation), state: 'reserved' } };
  h.repository.state.jobs.own = corruptReserved;
  const ownCash = await h.reject('client:client', { type: 'cash', jobId: 'own' }, 'SelfOrderForbidden');
  await h.reject('client:client', { type: 'initiate_payment', jobId: 'own', id: 'self-payment-new', route: 'card' }, 'SelfOrderForbidden');
  corruptReserved.reservation.operations.push({ id: 'self-payment', amount: 1000n, currency: 'THB', route: 'card', initiatedAt: h.clock.value, providerDeadline: h.clock.value + 900, providerTimer: timer(h.clock.value, 900, h.config.version), status: 'pending', reason: null });
  h.outcomes.set('self-success', { operationId: 'self-payment', amount: 1000n, currency: 'THB', status: 'success' });
  await h.reject('admin', { type: 'payment_outcome', jobId: 'own', proof: 'self-success' }, 'SelfOrderForbidden');
  const directAssignment = structuredClone(corruptReserved); directAssignment.reservation.state = 'assigned';
  err(checked(() => M.assignment(directAssignment, h.repository.state, h.config, h.clock.value)), 'SelfOrderForbidden');
  const noSelfEffects = h.repository.state.jobs.own.state === 'reserved' && h.repository.state.jobs.own.reservation.operations[0].status === 'pending' && Object.keys(h.repository.state.ledger).length === 0 && !h.repository.state.refusalStreak.client;
  h.repository.state.jobs.own = cleanOwn; delete h.repository.state.threads['self-chat'];
  await h.ok('master2:master', { type: 'initial_offer', jobId: 'own', id: 'another-master', chatId: 'another-chat' });
  await h.ok('master2:master', { type: 'final_application', jobId: 'own', masterId: 'master2', amount: 1000n, recipientId: 'client', confirmed: true });
  await h.ok('client:client', { type: 'select_master', jobId: 'own', masterId: 'master2', amount: 1000n, confirmed: true });
  await h.ok('client:client', { type: 'cash', jobId: 'own' });
  const independentRoles = h.repository.state.jobs.other.state === 'assigned' && h.repository.state.jobs.other.clientId === 'stranger' && h.repository.state.jobs.other.selectedMasterId === 'client' && h.repository.state.jobs.own.state === 'assigned' && h.repository.state.jobs.own.selectedMasterId === 'master2' && h.repository.state.users.client.clientActive && h.repository.state.users.client.masterActive;
  await proofs(t, [
    ['OWN.1', !ownFeed.value.jobs.some(job => job.id === 'own') && available.value.jobs.some(job => job.id === 'other'), blocked(() => M.feed(publishedOwnState, 'client', publishedOwnState.users.client.specialization, h.clock.value, { includes: () => true }).some(job => job.id === 'own')), null, 'even an actual permissive injected feed policy cannot expose the matching published self-order'],
    ['OWN.2', !published.recipients.includes('client') && otherNotification.recipients.includes('client'), ownNotificationDelivery, 'Unauthorized', 'actual dispatch cannot force delivery of the self-order Master publication event to its owner'],
    ['OWN.3', independentRoles && !h.repository.state.messages['self-message'], ownOffer, 'SelfOrderForbidden', 'server rejects own initial offer, without creating an offer or chat'],
    ['OWN.4', h.repository.state.threads['other-chat'].messageIds.length === 2, ownMessage, 'SelfOrderForbidden', 'server rejects own chat/price/final/termination and direct chat creation despite forged saved relation'],
    ['OWN.5', h.repository.state.jobs.own.selectedMasterId === 'master2' && h.repository.state.jobs.own.financial.fap === 1000n, ownSelection, 'SelfOrderForbidden', 'valid-looking own final cannot create self reservation or financial snapshot'],
    ['OWN.6', noSelfEffects && independentRoles, ownCash, 'SelfOrderForbidden', 'cash, noncash initiation, callback and direct assignment all block self pair with no financial/refusal effects'],
    ['OWN.7', independentRoles, ownOffer, 'SelfOrderForbidden', 'one account works independently as Client with another Master and Master for another Client'],
  ], 'feed/initialOffer/offerAvailable/createJobChat/participant/assignment/DomainCore.execute', 'apps/backend/src/domain/marketplace.ts; apps/backend/src/domain/messaging.ts; apps/backend/src/application/domain-core.ts', ['AtomicRepository', 'AuthenticationPort', 'PhotoMetadataPort', 'PaymentProviderPort']);
  inputGap = { id: 'INPUT-SELF-OFFER', status: 'RESOLVED_BY_OWNER_AND_TESTED', normativeReferences: ['11.4.1'], observed: { oneUserId: 'client', clientActive: true, masterActive: true, matchingSpecialization: true, ownJobInFeed: false, ownOfferResult: ownOffer, ownJobNotification: false, noMutationAfterRejectedOffer: true, selfFinancialEffectsPrevented: noSelfEffects, independentRoles }, ownerDecision: 'No same-user Client/Master pair within one job; server enforcement and isolation to that job' };
});

test('Individual Application boundary and cross-aggregate evidence', async t => {
  const h = harness(); await h.assigned('card');
  const locale = await h.ok('client:client', { type: 'locale', locale: 'ru' });
  const badCommand = await h.reject('client:client', { type: 'unsupported' }, 'InvalidTransition');
  const goodQuery = await read(h, 'master:master', { type: 'job', jobId: 'job' });
  const badQuery = await read(h, 'master:master', { type: 'unsupported' });
  let photoCalls = 0, detectionCalls = 0;
  const lookup = h.ports.photos.lookup, detect = h.ports.translation.detect;
  h.ports.photos.lookup = async ids => { photoCalls++; return lookup(ids); };
  h.ports.translation.detect = async original => { detectionCalls++; return detect(original); };
  await h.message('master:master', 'Actual work', 'job', 'master', { photoIds: ['master-work'] });
  const calls = [photoCalls, detectionCalls];
  const foreign = await h.reject('stranger:client', { type: 'message', id: 'forbidden-export', chatId: 'chat:job:master', original: 'Unauthorized content', photoIds: ['photo'], sender: 'user' }, 'Unauthorized');
  const noExport = photoCalls === calls[0] && detectionCalls === calls[1];
  await h.assigned('cash', 'other'); const thread = h.repository.state.threads['chat:job:master']; thread.context.jobId = 'other';
  const corrupt = await read(h, 'master:master', { type: 'chat_history', chatId: 'chat:job:master' }); thread.context.jobId = 'job';
  const payout = harness({ commission: ratio(0n) }); await payout.completed('card'); await payout.ok('admin', { type: 'start_payout', jobId: 'job', attemptId: 'out' });
  payout.outcomes.set('forged-binding', { operationId: 'out', amount: 1000n, currency: 'THB', status: 'success', binding: F.paymentBinding('job') });
  const forged = await payout.reject('admin', { type: 'payout_outcome', jobId: 'job', proof: 'forged-binding' }, 'ProviderConflict');
  payout.outcomes.set('paid', { operationId: 'out', amount: 1000n, currency: 'THB', status: 'success' });
  await payout.ok('admin', { type: 'payout_outcome', jobId: 'job', proof: 'paid' });
  const resolution = harness(); await resolution.assigned('card');
  await resolution.ok('master:master', { type: 'cancel', jobId: 'job', id: 'request', reason: 'refusal', explanation: 'I cannot continue', remainingWork: '', classification: 'unclassified', confirmed: true, evidence: [] });
  const decision = { id: 'decision', type: 'master_refusal', reason: 'Reviewed actual master request', evidence: ['invented'], facts: { arrived: false, partialWork: false, voluntaryRefusalProven: true, acceptanceReviewed: false, historyReviewed: false } };
  const invented = await resolution.reject('admin', { type: 'decide_resolution', caseId: 'case:request', decision }, 'EvidenceRequired');
  await resolution.ok('admin', { type: 'decide_resolution', caseId: 'case:request', decision: { ...decision, evidence: ['request'] } });
  await proofs(t, [
    ['APP.1', locale.outcome.user.locale === 'ru', badCommand, 'InvalidTransition', 'supported command succeeds; unknown runtime command is a typed rejection with rollback'],
    ['APP.2', goodQuery.ok && goodQuery.value.type === 'job', badQuery, 'InvalidTransition', 'supported query succeeds; unknown runtime query never returns successful undefined'],
    ['APP.3', calls[0] === 1 && calls[1] === 1 && noExport, foreign, 'Unauthorized', 'actual authorized photo/detection calls occur; unauthorized content is never exported'],
    ['APP.4', goodQuery.ok && (await read(h, 'master:master', { type: 'job', jobId: 'other' })).ok, corrupt, 'InvalidReference', 'direct read checks saved thread/job/offer relations and preserves unrelated valid order access'],
    ['APP.5', payout.repository.state.payouts.job.settled && payout.repository.state.payouts.job.attempts.length === 1, forged, 'ProviderConflict', 'authenticated proof from another direction cannot settle an outgoing obligation; correctly bound proof succeeds'],
    ['APP.6', resolution.repository.state.cases['case:request'].decision.basis[0].id === 'request', invented, 'EvidenceRequired', 'actual persisted request supports adjudication; nonexistent evidence cannot change finance/refusal'],
  ], 'DomainCore.execute/query/jobById/threadById/requireBinding/resolutionEvidence', 'apps/backend/src/application/domain-core.ts; apps/backend/src/application/queries.ts; apps/backend/src/application/invariants.ts; apps/backend/src/domain/finance.ts; apps/backend/src/domain/work.ts', ['AtomicRepository', 'AuthenticationPort', 'PhotoMetadataPort', 'TranslationPort', 'PaymentProviderPort']);
});

after(async () => {
  const directory = path.join(root, 'docs/f2/evidence'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'individual-proofs.json'), `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(path.join(directory, 'policy-matrix.json'), `${JSON.stringify(matrix, (_, v) => typeof v === 'bigint' ? `${v}n` : v, 2)}\n`);
  await writeFile(path.join(directory, 'input-gap.json'), `${JSON.stringify(inputGap, null, 2)}\n`);
});

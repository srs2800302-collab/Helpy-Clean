import { authorize, checked, identifier, immutable, own, positiveInteger, put, requiredLocales, requireThat, unwrap } from './core.js';
import type { Principal, Result, Role } from './core.js';

export interface TextRevision {
  readonly id: string;
  readonly revision: number;
  readonly meaning: number;
  readonly editions: Readonly<Record<string, { readonly text: string; readonly revision: number; readonly approvedBy: string | null }>>;
}
export interface Condition { readonly questionId: string; readonly equals: string | boolean | number }
export interface Question {
  readonly id: string; readonly textId: string; readonly required: boolean;
  readonly kind: 'text' | 'boolean' | 'integer' | 'choice' | 'dimensions';
  readonly choices?: readonly { readonly id: string; readonly textId: string }[];
  readonly when?: readonly Condition[];
}
export interface PhotoRequest {
  readonly id: string; readonly textId: string; readonly minimum: number; readonly maximum?: number;
  readonly formats: readonly string[]; readonly when?: readonly Condition[];
}
export interface TableDefinition {
  readonly id: string; readonly textId: string; readonly initialRows: number;
  readonly fixedRows?: number; readonly minimumRows: number;
  readonly columns: readonly Question[];
}
export interface RouteTarget { readonly categoryId: string; readonly entityId: string; readonly scenarioId: string }
export interface RoutingRule { readonly id: string; readonly when: readonly Condition[]; readonly target: RouteTarget }
export interface FormDefinition {
  readonly id: string; readonly questions: readonly Question[]; readonly photos: readonly PhotoRequest[];
  readonly tables: readonly TableDefinition[]; readonly routes: readonly RoutingRule[];
  readonly stops: readonly { readonly id: string; readonly when: readonly Condition[]; readonly textId: string }[];
  readonly linkedCategories: readonly string[];
}
export type Architecture = 'scenario_first' | 'terminal' | 'equipment' | 'repeatable_points' | 'structured' | 'equipment_list';
export interface Category { readonly id: string; readonly title: string; readonly description: string; readonly architecture: Architecture; readonly enabled: boolean; readonly order: number }
export interface ServiceEntity { readonly id: string; readonly categoryId: string; readonly title: string; readonly description: string; readonly enabled: boolean; readonly order: number; readonly scenarioIds: readonly string[] }
export interface Scenario { readonly id: string; readonly entityId: string; readonly action: string; readonly title: string; readonly form: FormDefinition }
export interface InformationBlock { readonly id: string; readonly revision: number; readonly textId: string; readonly roles: readonly ('client' | 'master')[]; readonly enabled: boolean }
export interface RuleBinding { readonly id: string; readonly blockId: string; readonly blockRevision: number; readonly role: 'client' | 'master'; readonly categoryId?: string; readonly entityId?: string; readonly scenarioId?: string; readonly order: number }
export interface CatalogRevision {
  readonly id: string; readonly version: number; readonly sequence: number; readonly status: 'draft' | 'published';
  readonly texts: readonly TextRevision[]; readonly categories: readonly Category[]; readonly entities: readonly ServiceEntity[];
  readonly scenarios: readonly Scenario[]; readonly blocks: readonly InformationBlock[]; readonly bindings: readonly RuleBinding[];
}
export interface CatalogRepositoryState { drafts: Record<string, CatalogRevision>; published: Record<string, CatalogRevision>; current: string | null }
export function catalogKey(catalog: Pick<CatalogRevision, 'id' | 'version'>): string { return `${catalog.id}:${catalog.version}`; }
function unique(values: readonly string[]): void { values.forEach(identifier); requireThat(new Set(values).size === values.length, 'InvalidReference', 'Duplicate identity'); }
function textReference(catalog: CatalogRevision, id: string): void { requireThat(catalog.texts.some(text => text.id === id), 'InvalidReference', id); }
export function validateCatalog(catalog: CatalogRevision, publication = false): Result<CatalogRevision> {
  return checked(() => {
    requireThat(catalog && [catalog.texts, catalog.categories, catalog.entities, catalog.scenarios, catalog.blocks, catalog.bindings].every(Array.isArray), 'InvalidConfiguration');
    identifier(catalog.id); requireThat(positiveInteger(catalog.version) && positiveInteger(catalog.sequence), 'StaleRevision');
    for (const collection of [catalog.texts, catalog.categories, catalog.entities, catalog.scenarios, catalog.blocks, catalog.bindings]) unique(collection.map(value => value.id));
    for (const text of catalog.texts) {
      requireThat(positiveInteger(text.revision) && positiveInteger(text.meaning), 'StaleRevision');
      requireThat(text.editions && typeof text.editions === 'object' && Object.values(text.editions).every(edition => edition && typeof edition.text === 'string' && positiveInteger(edition.revision)), 'InvalidConfiguration');
      requireThat(Object.keys(text.editions).every(locale => /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)), 'InvalidLocale');
      for (const locale of requiredLocales) {
        const edition = own(text.editions, locale);
        requireThat(!publication || (edition && edition.text.trim() && edition.approvedBy && edition.revision === text.revision), 'ApprovalRequired', `${text.id}:${locale}`);
      }
      if (publication) requireThat(Object.values(text.editions).every(edition => edition.text.trim() && edition.approvedBy && edition.revision === text.revision), 'ApprovalRequired');
    }
    for (const category of catalog.categories) {
      requireThat(typeof category.enabled === 'boolean', 'InvalidConfiguration');
      requireThat(['scenario_first', 'terminal', 'equipment', 'repeatable_points', 'structured', 'equipment_list'].includes(category.architecture), 'InvalidConfiguration');
      requireThat(Number.isSafeInteger(category.order) && category.order >= 0, 'InvalidConfiguration');
      textReference(catalog, category.title); textReference(catalog, category.description);
    }
    for (const entity of catalog.entities) {
      requireThat(typeof entity.enabled === 'boolean' && Array.isArray(entity.scenarioIds), 'InvalidConfiguration');
      requireThat(catalog.categories.some(category => category.id === entity.categoryId), 'InvalidReference');
      requireThat(Number.isSafeInteger(entity.order) && entity.order >= 0 && entity.scenarioIds.length > 0, 'InvalidConfiguration');
      textReference(catalog, entity.title); textReference(catalog, entity.description); unique(entity.scenarioIds);
      requireThat(entity.scenarioIds.every(id => catalog.scenarios.some(scenario => scenario.id === id && scenario.entityId === entity.id)), 'InvalidReference');
    }
    for (const scenario of catalog.scenarios) {
      identifier(scenario.action); textReference(catalog, scenario.title);
      requireThat(catalog.entities.some(entity => entity.id === scenario.entityId && entity.scenarioIds.includes(scenario.id)), 'InvalidReference');
      const form = scenario.form; requireThat(form, 'InvalidConfiguration'); identifier(form.id);
      requireThat([form.questions, form.photos, form.tables, form.routes, form.stops, form.linkedCategories].every(Array.isArray), 'InvalidConfiguration');
      unique([...form.questions, ...form.photos, ...form.tables, ...form.routes, ...form.stops].map(value => value.id));
      const preceding = new Map<string, Question>();
      const validateConditions = (conditions: readonly Condition[] = [], known = preceding) => {
        requireThat(Array.isArray(conditions), 'InvalidConfiguration');
        for (const condition of conditions) {
          const question = known.get(condition.questionId); requireThat(question, 'InvalidReference', 'Missing or cyclic dependency');
          requireThat(answerValid(question, condition.equals), 'InvalidConfiguration', 'Condition value type');
        }
      };
      const validateQuestion = (question: Question) => {
        requireThat(typeof question.required === 'boolean', 'InvalidConfiguration');
        textReference(catalog, question.textId);
        requireThat(['text', 'boolean', 'integer', 'choice', 'dimensions'].includes(question.kind), 'InvalidConfiguration');
        if (question.kind === 'choice') {
          requireThat(question.choices && question.choices.length > 0, 'InvalidConfiguration');
          unique(question.choices.map(choice => choice.id)); question.choices.forEach(choice => textReference(catalog, choice.textId));
        }
      };
      for (const question of form.questions) { validateConditions(question.when); validateQuestion(question); preceding.set(question.id, question); }
      for (const photo of form.photos) {
        textReference(catalog, photo.textId); validateConditions(photo.when);
        requireThat(Number.isSafeInteger(photo.minimum) && photo.minimum >= 0 && photo.formats.length > 0 && photo.formats.every(format => /^image\/[a-z0-9.+-]+$/.test(format)) &&
          (photo.maximum === undefined || (Number.isSafeInteger(photo.maximum) && photo.maximum >= photo.minimum)), 'InvalidConfiguration');
      }
      for (const table of form.tables) {
        textReference(catalog, table.textId); unique(table.columns.map(column => column.id));
        requireThat(table.columns.length > 0 && Number.isSafeInteger(table.initialRows) && table.initialRows >= table.minimumRows &&
          Number.isSafeInteger(table.minimumRows) && table.minimumRows >= 0 &&
          (table.fixedRows === undefined || table.fixedRows === table.initialRows), 'InvalidConfiguration');
        const columns = new Map<string, Question>();
        for (const column of table.columns) { validateQuestion(column); validateConditions(column.when, columns); columns.set(column.id, column); }
      }
      const entity = catalog.entities.find(entity => entity.id === scenario.entityId)!;
      const sourceActive = entity.enabled && catalog.categories.some(category => category.id === entity.categoryId && category.enabled);
      for (const route of form.routes) { validateConditions(route.when); resolveRoute(catalog, route.target, sourceActive); }
      for (const stop of form.stops) { validateConditions(stop.when); textReference(catalog, stop.textId); }
      requireThat(form.linkedCategories.every(id => catalog.categories.some(category => category.id === id && (!sourceActive || category.enabled))), 'InvalidReference');
    }
    for (const block of catalog.blocks) {
      requireThat(typeof block.enabled === 'boolean' && new Set(block.roles).size === block.roles.length, 'InvalidConfiguration');
      requireThat(positiveInteger(block.revision) && block.roles.length > 0 && block.roles.every(role => role === 'client' || role === 'master'), 'InvalidReference');
      textReference(catalog, block.textId);
    }
    for (const binding of catalog.bindings) {
      const block = catalog.blocks.find(value => value.id === binding.blockId);
      requireThat(block && block.revision === binding.blockRevision && block.roles.includes(binding.role) && block.enabled, 'InvalidReference');
      requireThat(Number.isSafeInteger(binding.order) && binding.order >= 0, 'InvalidConfiguration');
      const entity = catalog.entities.find(value => value.id === binding.entityId);
      if (binding.categoryId) requireThat(catalog.categories.some(category => category.id === binding.categoryId), 'InvalidReference');
      if (binding.entityId) requireThat(entity && (!binding.categoryId || entity.categoryId === binding.categoryId), 'InvalidReference');
      if (binding.scenarioId) requireThat(catalog.scenarios.some(value => value.id === binding.scenarioId && (!entity || value.entityId === entity.id) &&
        (!binding.categoryId || catalog.entities.some(owner => owner.id === value.entityId && owner.categoryId === binding.categoryId))), 'InvalidReference');
    }
    return catalog;
  });
}
export function resolveRoute(catalog: CatalogRevision, target: RouteTarget, activeOnly = true): { category: Category; entity: ServiceEntity; scenario: Scenario } {
  const category = catalog.categories.find(value => value.id === target.categoryId);
  const entity = catalog.entities.find(value => value.id === target.entityId);
  const scenario = catalog.scenarios.find(value => value.id === target.scenarioId);
  requireThat(category && entity && scenario && entity.categoryId === category.id && scenario.entityId === entity.id && entity.scenarioIds.includes(scenario.id), 'InvalidReference');
  requireThat(!activeOnly || category.enabled && entity.enabled, 'InactiveEntity');
  return { category, entity, scenario };
}
export function saveCatalogDraft(state: CatalogRepositoryState, actor: Principal, draft: CatalogRevision, expectedSequence: number | null): Result<CatalogRevision> {
  return checked(() => {
    authorize(actor, 'catalog'); const key = catalogKey(draft); const old = own(state.drafts, key);
    requireThat(draft.status === 'draft' && !own(state.published, key), 'StaleRevision');
    requireThat(!Object.values(state.published).some(published => published.id === draft.id && published.version >= draft.version), 'StaleRevision');
    requireThat(old ? old.sequence === expectedSequence && draft.sequence === old.sequence + 1 : expectedSequence === null && draft.sequence === 1, 'Conflict');
    unwrap(validateCatalog(draft));
    if (old) for (const text of draft.texts) {
      const previous = old.texts.find(value => value.id === text.id);
      const locales = new Set([...Object.keys(text.editions), ...Object.keys(previous?.editions ?? {})]);
      if (previous && (text.revision !== previous.revision || text.meaning !== previous.meaning || [...locales].some(locale => own(text.editions, locale)?.text !== own(previous.editions, locale)?.text))) {
        requireThat(text.revision > previous.revision && Object.values(text.editions).every(edition => !edition.approvedBy), 'ApprovalRequired');
      } else requireThat(previous ? Object.entries(text.editions).every(([locale, edition]) => edition.approvedBy === own(previous.editions, locale)?.approvedBy && edition.revision === own(previous.editions, locale)?.revision) :
        Object.values(text.editions).every(edition => edition.approvedBy === null), 'ApprovalRequired');
    }
    else requireThat(draft.texts.every(text => Object.values(text.editions).every(edition => edition.approvedBy === null)), 'ApprovalRequired');
    put(state.drafts, key, draft); return draft;
  });
}
export function approveText(state: CatalogRepositoryState, actor: Principal, key: string, textId: string,
  locale: string, expectedSequence: number, expectedRevision: number): CatalogRevision {
  authorize(actor, 'content_approval'); requireThat(requiredLocales.includes(locale as typeof requiredLocales[number]), 'InvalidLocale');
  const draft = own(state.drafts, key); requireThat(draft && draft.sequence === expectedSequence, 'Conflict');
  const text = draft.texts.find(value => value.id === textId); const edition = text && own(text.editions, locale);
  requireThat(text && text.revision === expectedRevision && edition && edition.text.trim() && edition.revision === expectedRevision, 'StaleRevision');
  const updated = { ...draft, sequence: draft.sequence + 1, texts: draft.texts.map(value => value.id === textId ?
    { ...text, editions: { ...text.editions, [locale]: { ...edition, approvedBy: actor.userId } } } : value) };
  put(state.drafts, key, updated); return updated;
}
export function approveContentSet(state: CatalogRepositoryState, actor: Principal, key: string, expectedSequence: number,
  revisions: readonly { readonly textId: string; readonly revision: number }[], confirmed: boolean): CatalogRevision {
  authorize(actor, 'content_approval'); requireThat(confirmed === true, 'ConfirmationRequired');
  const draft = own(state.drafts, key); requireThat(draft && draft.sequence === expectedSequence, 'Conflict');
  unique(revisions.map(value => value.textId));
  requireThat(revisions.length === draft.texts.length && revisions.every(value => draft.texts.some(text => text.id === value.textId && text.revision === value.revision)), 'StaleRevision');
  const texts = draft.texts.map(text => ({ ...text, editions: Object.fromEntries(Object.entries(text.editions).map(([locale, edition]) => {
    requireThat(edition.text.trim() && edition.revision === text.revision, 'ApprovalRequired'); return [locale, { ...edition, approvedBy: actor.userId }];
  })) }));
  requireThat(texts.every(text => requiredLocales.every(locale => own(text.editions, locale))), 'ApprovalRequired');
  const updated = { ...draft, sequence: draft.sequence + 1, texts }; put(state.drafts, key, updated); return updated;
}
export function publishCatalog(state: CatalogRepositoryState, actor: Principal, key: string, expectedSequence: number): CatalogRevision {
  authorize(actor, 'catalog'); const draft = own(state.drafts, key); requireThat(draft && draft.sequence === expectedSequence, 'Conflict');
  unwrap(validateCatalog(draft, true));
  requireThat(!own(state.published, key), 'Conflict');
  requireThat(!Object.values(state.published).some(published => published.id === draft.id && published.version >= draft.version), 'StaleRevision');
  const published: CatalogRevision = immutable({ ...draft, status: 'published' });
  put(state.published, key, published); delete state.drafts[key]; state.current = key; return published;
}
export function publishedText(catalog: CatalogRevision, textId: string, locale: string): string {
  const text = catalog.texts.find(value => value.id === textId); const edition = text && own(text.editions, locale);
  requireThat(catalog.status === 'published' && edition?.approvedBy && edition.revision === text?.revision, 'ApprovalRequired'); return edition.text;
}
function applicableBindings(catalog: CatalogRevision, targets: readonly RouteTarget[]): readonly RuleBinding[] {
  targets.forEach(target => resolveRoute(catalog, target));
  return catalog.bindings.filter(binding => !binding.categoryId && !binding.entityId && !binding.scenarioId ||
    targets.some(target => (!binding.categoryId || target.categoryId === binding.categoryId) && (!binding.entityId || target.entityId === binding.entityId) && (!binding.scenarioId || target.scenarioId === binding.scenarioId)));
}
export function information(catalog: CatalogRevision, targets: readonly RouteTarget[], role: Role, locale: string): readonly { id: string; revision: number; text: string }[] {
  requireThat(role === 'client' || role === 'master', 'Unauthorized');
  const bindings = applicableBindings(catalog, targets).filter(binding => binding.role === role);
  const seen = new Set<string>();
  return [...bindings].sort((a, b) => a.order - b.order).flatMap(binding => {
    const block = catalog.blocks.find(value => value.id === binding.blockId);
    requireThat(block && block.enabled && block.revision === binding.blockRevision && block.roles.includes(role), 'InvalidReference');
    const key = `${block.id}:${block.revision}`; if (seen.has(key)) return []; seen.add(key);
    return [{ id: block.id, revision: block.revision, text: publishedText(catalog, block.textId, locale) }];
  });
}
export function ruleReferences(catalog: CatalogRevision, targets: readonly RouteTarget[]): readonly { id: string; revision: number }[] {
  const result = new Map<string, { id: string; revision: number }>();
  for (const binding of applicableBindings(catalog, targets)) {
    const block = catalog.blocks.find(block => block.id === binding.blockId);
    requireThat(block?.enabled && block.revision === binding.blockRevision && block.roles.includes(binding.role), 'InvalidReference');
    result.set(`${block.id}:${block.revision}`, { id: block.id, revision: block.revision });
  }
  return [...result.values()];
}
export type Answer = string | boolean | number | readonly number[];
export interface ScopeItem extends RouteTarget {
  readonly id: string; readonly answers: Readonly<Record<string, Answer>>;
  readonly photos: Readonly<Record<string, readonly string[]>>;
  readonly tables: Readonly<Record<string, readonly Readonly<Record<string, Answer>>[]>>;
}
export interface PhotoMetadata { readonly id: string; readonly ownerId: string; readonly present: boolean; readonly format: string }
export function requirePhotos(ids: readonly string[], photos: readonly PhotoMetadata[], userId: string): void {
  requireThat(Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.trim()) && Array.isArray(photos) &&
    new Set(ids).size === ids.length && photos.length === ids.length && new Set(photos.map(photo => photo?.id)).size === ids.length &&
    photos.every(photo => photo && ids.includes(photo.id) && photo.ownerId === userId && photo.present === true &&
      typeof photo.format === 'string' && /^image\/[a-z0-9.+-]+$/.test(photo.format)), 'InvalidPhoto');
}
function active(conditions: readonly Condition[] = [], answers: ScopeItem['answers']): boolean {
  return conditions.every(condition => own(answers, condition.questionId) === condition.equals);
}
export function checkRouting(catalog: CatalogRevision, items: readonly ScopeItem[]): void {
  for (const item of items) {
    const { scenario } = resolveRoute(catalog, item);
    for (const route of scenario.form.routes) if (active(route.when, item.answers)) requireThat(false, 'RouteRequired', `${route.target.categoryId}/${route.target.entityId}/${route.target.scenarioId}`);
    for (const stop of scenario.form.stops) requireThat(!active(stop.when, item.answers), 'StopCondition', stop.textId);
  }
}
function answerValid(question: Question, answer: Answer | undefined): boolean {
  if (answer === undefined) return !question.required;
  switch (question.kind) {
    case 'text': return typeof answer === 'string' && answer.trim().length > 0;
    case 'boolean': return typeof answer === 'boolean';
    case 'integer': return typeof answer === 'number' && positiveInteger(answer);
    case 'choice': return typeof answer === 'string' && !!question.choices?.some(choice => choice.id === answer);
    case 'dimensions': return Array.isArray(answer) && answer.length === 3 && answer.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
  }
}
export function validateScope(catalog: CatalogRevision, items: readonly ScopeItem[], photos: readonly PhotoMetadata[], userId: string): Result<readonly ScopeItem[]> {
  return checked(() => {
    requireThat(catalog.status === 'published' && items.length > 0, 'InvalidScope'); unique(items.map(item => item.id));
    requireThat(new Set(items.map(item => item.categoryId)).size === 1, 'InvalidScope');
    for (const item of items) {
      requireThat(Object.keys(item).every(key => ['id', 'categoryId', 'entityId', 'scenarioId', 'answers', 'photos', 'tables'].includes(key)), 'InvalidScope', 'Unsupported scope field');
      const { category, scenario } = resolveRoute(catalog, item);
      requireThat(items.length === 1 || ['repeatable_points', 'equipment_list'].includes(category.architecture), 'InvalidScope');
      const form = scenario.form;
      requireThat(Object.keys(item.answers).every(id => form.questions.some(question => question.id === id)), 'InvalidScope');
      const activeAnswers: Record<string, Answer> = {};
      for (const question of form.questions) if (active(question.when, activeAnswers)) {
        requireThat(answerValid(question, own(item.answers, question.id)), 'RequiredAnswer', question.id);
        const answer = own(item.answers, question.id); if (answer !== undefined) put(activeAnswers, question.id, answer);
      } else requireThat(own(item.answers, question.id) === undefined, 'InvalidScope', 'Inactive answer');
      for (const route of form.routes) if (active(route.when, activeAnswers)) requireThat(false, 'RouteRequired', `${route.target.categoryId}/${route.target.entityId}/${route.target.scenarioId}`);
      for (const stop of form.stops) requireThat(!active(stop.when, activeAnswers), 'StopCondition', stop.textId);
      requireThat(Object.keys(item.photos).every(id => form.photos.some(photo => photo.id === id)), 'InvalidPhoto');
      for (const request of form.photos) if (active(request.when, activeAnswers)) {
        const ids = own(item.photos, request.id) ?? []; unique(ids);
        requireThat(ids.length >= request.minimum && (request.maximum === undefined || ids.length <= request.maximum), 'RequiredPhoto', request.id);
        requireThat(ids.every(id => photos.some(photo => photo.id === id && photo.ownerId === userId && photo.present && request.formats.includes(photo.format))), 'InvalidPhoto');
      } else requireThat((own(item.photos, request.id)?.length ?? 0) === 0, 'InvalidPhoto', 'Inactive photo request');
      requireThat(Object.keys(item.tables).every(id => form.tables.some(table => table.id === id)), 'InvalidScope');
      for (const table of form.tables) {
        const rows = own(item.tables, table.id) ?? [];
        requireThat(rows.length >= table.minimumRows && (table.fixedRows === undefined || rows.length === table.fixedRows), 'InvalidScope', table.id);
        for (const row of rows) {
          requireThat(Object.keys(row).every(id => table.columns.some(column => column.id === id)), 'InvalidScope', table.id);
          const cells: Record<string, Answer> = {};
          for (const column of table.columns) if (active(column.when, cells)) {
            requireThat(answerValid(column, own(row, column.id)), 'InvalidScope', `${table.id}:${column.id}`);
            const answer = own(row, column.id); if (answer !== undefined) put(cells, column.id, answer);
          } else requireThat(own(row, column.id) === undefined, 'InvalidScope', 'Inactive table cell');
        }
      }
    }
    requirePhotos([...new Set(items.flatMap(item => Object.values(item.photos).flat()))], photos, userId);
    return items;
  });
}

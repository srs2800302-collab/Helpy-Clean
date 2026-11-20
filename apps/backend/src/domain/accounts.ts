import { authorize, identifier, own, owner, put, requireThat } from './core.js';
import type { DomainEvent, Principal, Role } from './core.js';
import type { CatalogRevision } from './catalog.js';
import { sameFact } from './provenance.js';

export interface Specialization { readonly categoryIds: readonly string[]; readonly entityIds: readonly string[] }
export interface AuthIdentity { readonly method: string; readonly subject: string }
export interface VerifiedClaim {
  readonly id: string; readonly purpose: 'login' | 'bind' | 'recover'; readonly identity: AuthIdentity;
  readonly email: string | null; readonly phone: string | null; readonly expiresAt: number; readonly ownerId: string | null;
}
export interface User {
  readonly id: string; readonly createdAt: number; identities: AuthIdentity[]; email: string | null; phone: string | null;
  displayName: string; photoId: string | null; locale: string; clientActive: boolean; masterActive: boolean;
  specialization: Specialization; contacts: Record<string, string>;
}
export interface AccountState { users: Record<string, User>; consumedClaims: Record<string, string>; readonly events?: readonly DomainEvent[] }
export function accountById(state: AccountState, id: string): User {
  const user = own(state.users, id); requireThat(user, 'NotFound'); requireThat(user.id === id, 'InvalidReference');
  requireThat(Number.isSafeInteger(user.createdAt) && Array.isArray(user.identities) && user.identities.every(identity => identity &&
    typeof identity.method === 'string' && identity.method.trim() && typeof identity.subject === 'string' && identity.subject.trim()) &&
    (user.email === null || typeof user.email === 'string') && (user.phone === null || typeof user.phone === 'string') &&
    typeof user.displayName === 'string' && (user.photoId === null || typeof user.photoId === 'string') && typeof user.locale === 'string' &&
    user.contacts && typeof user.contacts === 'object' && !Array.isArray(user.contacts) && Object.values(user.contacts).every(value => typeof value === 'string') &&
    user.specialization && Array.isArray(user.specialization.categoryIds) && Array.isArray(user.specialization.entityIds) &&
    [...user.specialization.categoryIds, ...user.specialization.entityIds].every(value => typeof value === 'string'), 'InvalidReference');
  const records = state.events?.filter(record => record.context.kind === 'account' && record.context.userId === id &&
    ['operation:login', 'operation:recover', 'operation:profile', 'operation:activate', 'operation:locale', 'operation:bind_contact'].includes(record.type)) ?? [];
  for (const record of records) requireThat(record.proof?.kind === 'account' && record.proof.user?.id === id && record.actorId === id, 'InvalidReference');
  const original = records.at(-1)?.proof;
  if (original?.kind === 'account') {
    const identity = (value: User) => ({ id: value.id, createdAt: value.createdAt, identities: value.identities, email: value.email, phone: value.phone });
    requireThat((user.clientActive === false || user.clientActive === original.user.clientActive) &&
      (user.masterActive === false || user.masterActive === original.user.masterActive) &&
      sameFact(identity(user), identity(original.user)), 'InvalidReference');
  }
  return user;
}
export function accountList(state: AccountState): readonly User[] {
  for (const record of state.events ?? []) if (record.proof?.kind === 'account') requireThat(own(state.users, record.proof.user.id), 'InvalidReference');
  return Object.keys(state.users).map(id => accountById(state, id));
}
function validateClaim(state: AccountState, claim: VerifiedClaim, purpose: VerifiedClaim['purpose'], now: number): void {
  identifier(claim.id);
  requireThat(claim.purpose === purpose && claim.expiresAt > now, 'ContactUnverified');
  const originals = state.events?.filter(record => ['operation:login', 'operation:recover', 'operation:bind_contact'].includes(record.type)) ?? [];
  for (const record of originals) requireThat(record.proof?.kind === 'account' && record.proof.claimId && record.proof.claimPurpose, 'InvalidReference');
  requireThat(!originals.some(record => record.proof?.kind === 'account' && record.proof.claimId === claim.id), 'ClaimConsumed');
  requireThat(!own(state.consumedClaims, claim.id), 'ClaimConsumed');
}
export function consumeClaim(state: AccountState, claim: VerifiedClaim, purpose: VerifiedClaim['purpose'], now: number): void {
  validateClaim(state, claim, purpose, now);
  put(state.consumedClaims, claim.id, purpose);
}
function identityOwner(state: AccountState, identity: AuthIdentity): User | undefined {
  const owners = accountList(state).filter(user => user.identities.some(value => value.method === identity.method && value.subject === identity.subject));
  requireThat(owners.length <= 1, 'IdentityOccupied');
  return owners[0];
}
export function login(state: AccountState, claim: VerifiedClaim, newId: string, now: number): User {
  validateClaim(state, claim, 'login', now); identifier(claim.identity.method); identifier(claim.identity.subject);
  const existing = identityOwner(state, claim.identity); if (existing) { consumeClaim(state, claim, 'login', now); return existing; }
  identifier(newId); requireThat(!own(state.users, newId), 'Conflict');
  requireThat(!claim.email || !Object.values(state.users).some(user => user.email === claim.email), 'IdentityOccupied');
  requireThat(!claim.phone || !Object.values(state.users).some(user => user.phone === claim.phone), 'IdentityOccupied');
  consumeClaim(state, claim, 'login', now);
  const user: User = { id: newId, createdAt: now, identities: [claim.identity], email: claim.email, phone: claim.phone,
    displayName: '', photoId: null, locale: 'en', clientActive: false, masterActive: false,
    specialization: { categoryIds: [], entityIds: [] }, contacts: {} };
  put(state.users, newId, user); return user;
}
export function bindContact(state: AccountState, actor: Principal, claim: VerifiedClaim, now: number): User {
  const user = accountById(state, actor.userId);
  validateClaim(state, claim, 'bind', now); requireThat(claim.ownerId === user.id && (claim.email || claim.phone), 'ContactUnverified');
  const existing = identityOwner(state, claim.identity); requireThat(!existing || existing.id === user.id, 'IdentityOccupied');
  requireThat(!Object.values(state.users).some(other => other.id !== user.id &&
    ((claim.email && other.email === claim.email) || (claim.phone && other.phone === claim.phone))), 'IdentityOccupied');
  consumeClaim(state, claim, 'bind', now);
  if (claim.email) user.email = claim.email;
  if (claim.phone) user.phone = claim.phone;
  if (!existing) user.identities.push(claim.identity);
  return user;
}
export function recover(state: AccountState, claim: VerifiedClaim, userId: string, now: number): User {
  validateClaim(state, claim, 'recover', now); const user = own(state.users, userId);
  requireThat(user && user.id === userId && claim.ownerId === user.id && claim.email && user.email === claim.email, 'ContactUnverified');
  accountById(state, userId); consumeClaim(state, claim, 'recover', now);
  return user;
}
export function validateSpecialization(value: Specialization, catalog: CatalogRevision): void {
  requireThat(value && Array.isArray(value.categoryIds) && Array.isArray(value.entityIds) &&
    [...value.categoryIds, ...value.entityIds].every(id => typeof id === 'string' && id.trim()), 'InvalidReference');
  requireThat(new Set(value.categoryIds).size === value.categoryIds.length && new Set(value.entityIds).size === value.entityIds.length &&
    value.categoryIds.every(id => catalog.categories.some(category => category.id === id && category.enabled)) &&
    value.entityIds.every(id => catalog.entities.some(entity => entity.id === id && entity.enabled && catalog.categories.some(category => category.id === entity.categoryId && category.enabled))), 'InvalidReference');
}
export function activate(user: User, actor: Principal, role: 'client' | 'master', catalog: CatalogRevision): User {
  requireThat(user.id === actor.userId, 'Unauthorized');
  requireThat(role === 'client' || role === 'master', 'Unauthorized');
  requireThat(user.email && typeof user.displayName === 'string' && user.displayName.trim(), 'ProfileIncomplete');
  if (role === 'master') {
    validateSpecialization(user.specialization, catalog);
    requireThat(user.phone && typeof user.photoId === 'string' && user.photoId.trim() &&
      user.specialization.categoryIds.length + user.specialization.entityIds.length > 0, 'ProfileIncomplete');
    user.masterActive = true;
  } else user.clientActive = true;
  return user;
}
export function requireActive(user: User | undefined, actor: Principal, role: Role): void {
  requireThat(['client', 'master', 'admin'].includes(role), 'Unauthorized');
  requireThat(user && user.id === actor.userId && actor.role === role, 'Unauthorized');
  requireThat(role === 'admin' || (role === 'client' ? user.clientActive === true : user.masterActive === true), 'RoleInactive');
}
export function switchRole(user: User, actor: Principal, role: 'client' | 'master'): Principal {
  requireThat(user.id === actor.userId, 'Unauthorized');
  requireThat(role === 'client' || role === 'master', 'Unauthorized');
  requireThat(role === 'client' ? user.clientActive === true : user.masterActive === true, 'RoleInactive');
  return { userId: user.id, role, permissions: [] };
}
export function privateContacts(user: User, actor: Principal): Readonly<Record<string, string | null>> {
  if (actor.userId !== user.id) authorize(actor, 'accounts');
  return { ...user.contacts, email: user.email, phone: user.phone };
}
export function updateProfile(user: User, actor: Principal, input: { displayName: string; photoId: string | null; specialization: Specialization }, catalog: CatalogRevision): User {
  owner(actor, user.id, actor.role); validateSpecialization(input.specialization, catalog);
  requireThat(typeof input.displayName === 'string' && input.displayName.trim(), 'ProfileIncomplete');
  requireThat(input.photoId === null || typeof input.photoId === 'string' && input.photoId.trim(), 'InvalidPhoto');
  requireThat(user.masterActive !== true || input.photoId, 'ProfileIncomplete');
  user.displayName = input.displayName; user.photoId = input.photoId; user.specialization = input.specialization; return user;
}
export function matches(specialization: Specialization, targets: readonly { categoryId: string; entityId: string }[]): boolean {
  return targets.length > 0 && targets.every(target => specialization.categoryIds.includes(target.categoryId) || specialization.entityIds.includes(target.entityId));
}

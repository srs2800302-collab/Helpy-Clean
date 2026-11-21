# HELPY — F3 Backend + Database
## Исполнительский контракт для SOL 6.1

**Редакция:** R9.3 — обязательная самостоятельная приёмка SOL и сквозной проход F1+F2+F3  
**Дата:** 2026-11-21  
**Статус:** DOCUMENT GATE — кандидат на утверждение владельцем  
**Baseline:** `5eb1e095f77d63e9dbb0f08077ba4681e37d5f0c`  
**F2:** OWNER_ACCEPTANCE=ACCEPT, OPEN_IMPLEMENTATION_DEFECTS=0  
**Цель:** реализовать весь F3 и передать один законченный кандидат с доказательствами.

---

# 1. Что требуется реализовать

F3 подключает к принятому F1/F2:

1. Cloudflare Worker;
2. D1;
3. migrations;
4. typed HTTP API;
5. persistence adapters;
6. transport/infrastructure error handling;
7. R2 + image processing;
8. local Text Safety;
9. Typhoon TranslationPort;
10. Worker Clock;
11. F3 tests + полный F1/F2 regression.

Архитектура:

`Worker / Node -> Transport -> Application -> Domain`

`Infrastructure adapters -> Application ports`

Domain/Application не зависят от Worker/D1/R2/Images/Typhoon/HTTP.

---

# 2. Нормативный приоритет

1. последующее явное решение владельца;
2. accepted F2 R35 + baseline source;
3. настоящий R9.1;
4. F1 architecture/foundation.

R4.1–R8.1 — только история проектирования.

Legacy HELPY для F3 не использовать.

---

# 3. Что запрещено менять

Без отдельного доказанного дефекта и решения владельца не менять существующую семантику:

```text
apps/backend/src/domain/**
apps/backend/src/application/domain-core.ts
apps/backend/src/application/queries.ts
apps/backend/src/application/invariants.ts
apps/backend/src/application/authorization.ts
apps/backend/src/application/validation.ts
apps/backend/src/application/text-safety.ts
```

Не менять F2:

- Command / Query / Outcome;
- CoreState;
- FailureCode;
- authorization;
- finance/order/chat/catalog/reputation/retention rules.

Разрешены только новые Application files для media boundary.

Не менять Mobile/Admin.

Не:

- хранить CoreState одним JSON row;
- делить F3 на несколько D1 databases;
- создавать 35 tables вручную через Cloudflare UI;
- придумывать fake auth/payment/notification;
- копировать legacy;
- commit/push/merge `main` без разрешения владельца.

---

# 4. Поверхность реализации

## Изменить минимально

```text
apps/backend/src/transport/http-handler.ts
apps/backend/src/infrastructure/node-server.ts
apps/backend/src/main.ts
apps/backend/package.json
packages/contracts/src/index.ts
packages/contracts/lib/helpy_contracts.dart
.github/workflows/verify.yml
tests/architecture.test.mjs
tests/f2-architecture.test.mjs
```

Root `package.json` менять только если нужен общий build tool.

## Создать

```text
apps/backend/
  wrangler.jsonc
  worker-configuration.d.ts
  tsconfig.worker.json
  migrations/0001_f3_base.sql
  src/
    application/
      photo-ports.ts
      photo-service.ts
    infrastructure/
      cloudflare/
        worker.ts
        composition.ts
      d1/
        d1-atomic-repository.ts
        d1-codec.ts
        d1-projection.ts
      media/
        r2-photo-store.ts
        cloudflare-image-processor.ts
      translation/
        typhoon-translation.ts
      text-safety/
        local-text-safety.ts
      clock/
        worker-clock.ts
```

Минимальные F3 tests:

```text
apps/backend/test/f3-d1-schema.test.mjs
apps/backend/test/f3-atomic-repository.test.mjs
apps/backend/test/f3-http.test.mjs
apps/backend/test/f3-photo.test.mjs
apps/backend/test/f3-text-safety.test.mjs
apps/backend/test/f3-typhoon.test.mjs
apps/backend/test/f3-clock.test.mjs
tests/f3-architecture.test.mjs
```

Дополнительные F3 files допустимы только внутри этих границ и должны быть обоснованы.

---

# 5. Build boundary

Текущий Node compile path сохранить.

Worker получает отдельный `tsconfig.worker.json`.

Обязательно:

- pinned Wrangler;
- pinned compatibility date;
- `wrangler types`;
- generated `worker-configuration.d.ts`;
- generated types не редактировать вручную;
- CI проверяет их актуальность;
- Node build и Worker typecheck/build проходят отдельно.

Не добавлять ORM.

---

# 6. Worker bindings

Минимум:

```text
DB              D1
PHOTO_BUCKET    private R2
IMAGES          Cloudflare Images binding
TYPHOON_API_KEY secret
```

Non-secret config:

```text
TYPHOON_BASE_URL=https://api.opentyphoon.ai/v1
TYPHOON_MODEL=typhoon-v2.5-30b-a3b-instruct
```

Secret value в Git/source/docs/tests запрещён.

---

# 7. D1 — общие правила

- одна D1;
- **35 HELPY tables**;
- HELPY tables `STRICT`;
- bigint/money = decimal `TEXT`;
- safe integer/time/order/bool = `INTEGER`;
- `REAL` для денег запрещён;
- typed/versioned JSON codec;
- NULL не подменяет bigint zero;
- no cascade delete history/finance/audit;
- performance indexes не назначать заранее;
- integrity PK/UQ/FK/CHECK/partial unique обязательны;
- 50+ synthetic categories без migration;
- pilot 20–30 categories = data, не schema limit.

---

# 8. Физическая схема — 35 tables

Сокращения: PK=primary key, UQ=unique, FK=foreign key, CK=check.  
Все неуказанные nullable-поля допускают NULL только согласно F2.

| # | Table | Обязательная физическая форма |
|---:|---|---|
| 1 | `repository_meta` | `id TEXT PK CK(id='core')`; `revision INTEGER NOT NULL CK>=0`; `codec_version INTEGER NOT NULL CK>0`; `commit_token TEXT NULL` |
| 2 | `operation_receipts` | `operation_id TEXT`; `chunk_index INTEGER CK>=0`; `actor_id TEXT`; `signature TEXT`; `chunk_count INTEGER CK>0`; `payload_chunk TEXT`; `codec_version INTEGER CK>0`; PK `(operation_id,chunk_index)` |
| 3 | `users` | `user_id TEXT PK`; `created_at INTEGER`; `email TEXT UQ NULL`; `phone TEXT UQ NULL`; `display_name TEXT`; `photo_id TEXT NULL`; `locale TEXT`; `client_active/master_active INTEGER CK 0/1`; `specialization_payload TEXT`; `contacts_payload TEXT` |
| 4 | `user_identities` | `method TEXT`; `subject TEXT`; `user_id TEXT FK users`; `position INTEGER CK>=0`; PK `(method,subject)`; UQ `(user_id,position)` |
| 5 | `consumed_claims` | `claim_id TEXT PK`; `purpose TEXT CK login/bind/recover`; append-only |
| 6 | `catalog_revisions` | `catalog_key TEXT PK`; `catalog_id TEXT`; `version INTEGER CK>0`; `sequence INTEGER CK>0`; `status TEXT CK draft/published`; `is_current INTEGER CK 0/1`; UQ `(catalog_id,version)`; CK `current=>published`; partial UQ: one current |
| 7 | `catalog_texts` | `catalog_key TEXT FK`; `text_id TEXT`; `position INTEGER CK>=0`; `revision INTEGER CK>0`; `meaning INTEGER CK>0`; `editions_payload TEXT`; PK `(catalog_key,text_id)`; UQ `(catalog_key,position)` |
| 8 | `catalog_items` | `catalog_key TEXT FK`; `item_type TEXT CK category/entity/scenario/block/binding`; `item_id TEXT`; `position INTEGER CK>=0`; `payload TEXT`; PK `(catalog_key,item_type,item_id)`; UQ `(catalog_key,item_type,position)` |
| 9 | `policies` | `version TEXT PK`; `position INTEGER UQ CK>=0`; `effective_at INTEGER UQ`; `policy_payload TEXT`; immutable after publish |
| 10 | `translation_corrections` | `old_catalog_key TEXT`; `text_id TEXT`; `new_catalog_key TEXT`; PK `(old_catalog_key,text_id)`; composite FK old/new -> `catalog_texts(catalog_key,text_id)` |
| 11 | `infrastructure_settings` | `setting_key TEXT PK`; `value_payload TEXT`; `revision INTEGER CK>0`; baseline `maxStoredPhotoBytes=1572864` |
| 12 | `jobs` | `job_id TEXT PK`; `client_id TEXT FK users`; `state TEXT CK F2 states`; `selected_master_id TEXT NULL FK users`; `selected_chat_id TEXT NULL`; `resolution_id TEXT NULL`; `linked_job_id TEXT NULL FK jobs`; `accepted_at/acceptance_operation_id/completed_at/last_activity_at NULL`; `job_payload TEXT`; partial UQ on non-null `linked_job_id` |
| 13 | `offers` | `offer_id TEXT PK`; `job_id TEXT FK jobs`; `master_id TEXT FK users`; `chat_id TEXT FK chat_threads UQ`; `catalog_key TEXT FK`; `initial_price TEXT`; `initial_at INTEGER`; `state TEXT CK open/selected/closed`; revised/final/closed payloads; UQ `(job_id,master_id)`; **no position** |
| 14 | `refusal_records` | `refusal_id TEXT PK`; `master_id TEXT FK`; `job_id TEXT FK`; `offer_id TEXT NULL FK`; `resolution_decision_id TEXT NULL logical`; `at INTEGER`; `operation_id TEXT UQ`; immutable |
| 15 | `refusal_streaks` | `master_id TEXT PK FK`; `streak INTEGER CK>=0` |
| 16 | `chat_threads` | `chat_id TEXT PK`; `context_type TEXT CK job/support`; `mode TEXT CK temporary/working/support/closed`; `created_at`; job-context fields OR support-context fields; `client_spoke/master_spoke/protected CK 0/1`; `waiting_for`; reminder/language payloads; CK forbids mixed contexts |
| 17 | `chat_messages` | `message_id TEXT PK`; `chat_id TEXT FK`; `position INTEGER CK>=0`; `author_id`; `sender TEXT CK user/helpy`; `original`; `original_language NULL`; `photo_ids_payload`; `at`; UQ `(chat_id,position)` |
| 18 | `inbox_messages` | `message_id TEXT PK`; `recipient_id TEXT FK users`; `original`; `at`; immutable |
| 19 | `feedback` | `feedback_id TEXT PK`; `author_id TEXT`; `original`; `at` |
| 20 | `job_financials` | `job_id TEXT PK FK jobs`; `funds TEXT CK none/held/releasable/allocated`; `financial_payload`; `reservation_payload` **without operations** |
| 21 | `payment_operations` | `operation_id TEXT PK`; `job_id TEXT FK job_financials`; `position INTEGER CK>=0`; `operation_payload`; UQ `(job_id,position)` |
| 22 | `master_finance` | `master_id TEXT PK FK users`; `debt_amount TEXT NULL`; `threshold_amount TEXT NULL`; CK at least one non-null |
| 23 | `threshold_history` | `master_id TEXT FK`; `version TEXT UQ`; `position INTEGER UQ CK>=0`; `amount TEXT NULL`; `effective_at`; PK `(master_id,version)` |
| 24 | `ledger_entries` | `ledger_id TEXT PK`; `master_id TEXT FK`; `basis TEXT UQ`; `change_amount TEXT`; `at`; `actor_id`; append-only |
| 25 | `financial_obligations` | `obligation_id TEXT PK`; `kind TEXT CK payout/refund/compensation`; `job_id TEXT FK`; `beneficiary_id TEXT FK`; `decision_id NULL logical`; `source_payment_id NULL FK`; `amount TEXT`; `currency CK THB`; `created_at`; `settled CK 0/1`; `type_payload`; partial UQ one payout per job |
| 26 | `transfer_attempts` | `attempt_id TEXT PK`; `obligation_id TEXT FK`; `position INTEGER CK>=0`; `attempt_payload`; UQ `(obligation_id,position)` |
| 27 | `debt_repayments` | request fields + optional agreement/receipt fields in one row; `request_id TEXT PK`; `master_id FK`; status CK requested/agreed/received/closed; methods CK cash/bank_transfer; `receipt_id UQ NULL`; reconstruct both F2 repayments + receipts |
| 28 | `resolution_cases` | `case_id TEXT PK`; `job_id TEXT UQ FK`; `request_id NULL`; `opened_at`; `snapshot_policy TEXT FK policies`; `evidence_payload`; `status`; `decision_id TEXT UQ NULL`; `decision_payload NULL`; CK decision id/payload both null or both set |
| 29 | `reviews` | `review_id TEXT PK`; `job_id TEXT UQ FK`; `client_id/master_id FK`; `stars INTEGER CK 1..5`; `marks_payload`; `comment`; `created_at`; `hidden CK 0/1`; `moderation_payload NULL` |
| 30 | `hidden_history` | `user_id TEXT FK`; `role TEXT CK client/master`; `job_id TEXT FK`; PK `(user_id,role,job_id)` |
| 31 | `domain_events` | `event_id TEXT PK`; `event_sequence INTEGER UQ CK>=0`; `operation_id`; type/subject/actor/time; recipients/roles/facts/context/proof/timers/retentions payloads; `policy_version NULL FK`; order only by sequence |
| 32 | `notification_preferences` | `user_id TEXT`; `role TEXT CK client/master/admin`; events/channels payloads; `sound_requested CK 0/1`; PK `(user_id,role)` |
| 33 | `deliveries` | `delivery_id TEXT PK`; `event_id TEXT FK`; recipient/role/channel; `attempt INTEGER CK>0`; `status TEXT CK requested/pending/delivered/failed`; UQ `(event_id,recipient_id,channel)` |
| 34 | `retention_records` | `fact_id TEXT`; `record_kind TEXT CK current/origin`; `kind TEXT CK communication/evidence/financial/audit/account`; `anchor NULL`; `anchor_kind CK completed/recorded`; `deadline NULL`; `policy_version FK`; PK `(fact_id,record_kind)` |
| 35 | `photo_metadata` | `photo_id TEXT PK`; `owner_id TEXT`; `format TEXT`; `business_ref_kind TEXT CK profile/job/chat`; `business_ref_id TEXT`; `present CK 0/1` |

**Финансы физически отсутствуют в `jobs`.**

Вложенные structures без самостоятельного lifecycle отдельной table не получают.

---

# 9. Порядок, который обязан пережить restart

Position/sequence обязателен только для:

```text
User.identities[]
CatalogRevision.texts[]
categories/entities/scenarios/blocks/bindings
Policy[]
ChatThread.messageIds[]
PaymentReservation.operations[]
TransferAttempt[]
thresholdHistory[]
CoreState.events[]
```

Не нужен для:

```text
Record maps
offers
hiddenHistory set
```

---

# 10. Codec/projection

Единый F3 codec обязан:

- bigint <-> decimal TEXT;
- сохранить NULL/absence distinction;
- сохранить array order;
- проверять codec version;
- reject malformed/unknown payload;
- обеспечить `CoreState -> rows -> CoreState` equivalent by F2 `sameFact`.

`AtomicRepository.read()` materializes CoreState из **31 state table**.

Не входят в CoreState:

```text
repository_meta
operation_receipts
infrastructure_settings
photo_metadata
```

---

# 11. AtomicRepository

Поведение = accepted F2 FakeRepository.

## `read`

- current consistent snapshot;
- detached;
- no writes/repair/partial result.

## `replay`

```text
current state
-> current access
-> receipt
-> absent: null
-> actor/signature mismatch: Conflict
-> match: saved success
```

## `transact`

```text
snapshot + revision + receipt
-> access
-> replay
-> detached working state
-> Domain update
-> failure: zero writes/receipt
-> success: physical diff
-> one D1 batch:
     revision guard
     row diff
     immutable events/history
     receipt chunks
     guard assertion
     token cleanup
```

`replay='reject'` + existing receipt => Conflict.

## Revision guard

Successful `transact` and successful `claimDelivery` increase global revision by 1.

Guard:

```sql
UPDATE repository_meta
SET revision = revision + 1, commit_token = :token
WHERE id='core'
  AND revision=:expected_revision
  AND codec_version=:codec_version;
```

Assertion before commit end:

```sql
UPDATE repository_meta
SET revision = CASE WHEN commit_token=:token THEN revision ELSE -1 END
WHERE id='core';
```

`revision CHECK >=0` forces stale attempt rollback.

Then:

```sql
UPDATE repository_meta
SET commit_token=NULL
WHERE id='core' AND commit_token=:token;
```

Stale revision = internal retry, not F2 `StaleRevision`.

Retry finite, documented, stress-tested. Exhaustion = repository-level failure.

Ambiguous write acknowledgement => confirmation read + receipt; never manual partial repair.

## `claimDelivery`

Only:

`requested -> pending`

Same revision guard.

Exactly one concurrent caller gets true.

Unknown outcome after pending does not auto-resend.

---

# 12. Receipt/idempotency

`operation_receipts` serves:

- F2 AtomicRepository successful operations;
- F3 photo upload idempotency.

Photo signature includes:

```text
photo_store
photoId
actor
businessRef kind/id
source MIME
source content digest
```

Same key + different actor/signature/content => Conflict.

Large result may use multiple receipt rows; no second receipt table.

---

# 13. Migrations

Required:

`apps/backend/migrations/0001_f3_base.sql`

Creates:

- exactly 35 HELPY tables;
- all integrity constraints;
- repository_meta/core;
- codec version;
- `maxStoredPhotoBytes=1572864`.

Does **not** seed:

- production Policy;
- production Catalog;
- pilot categories;
- users/jobs;
- providers.

Test Policy/Catalog = fixtures only.

Migration acceptance:

- clean local apply;
- deterministic ordering;
- repeated apply safe through migration system;
- failed migration rolls back itself;
- `foreign_key_check` clean.

---

# 14. Worker + Node Transport

`handleHttp()` becomes async runtime-neutral Transport.

Worker/Node do only:

```text
runtime request
-> HttpRequest
-> handleHttp
-> HttpResponse
-> runtime response
```

No business rules/authorization/SQL/finance in server adapters.

Node remains runnable and uses same wire contract.

---

# 15. API

Routes:

```text
GET  /health
POST /api/v1/account/access
POST /api/v1/commands
POST /api/v1/queries
POST /api/v1/translations/message
POST /api/v1/translations/draft
POST /api/v1/notifications/dispatch
PUT  /api/v1/photos/{photoId}
GET  /api/v1/photos/{photoId}
```

No route-per-command.

Money in JSON = decimal string only.

---

# 16. Обязательное покрытие всех 75 F2 operations

## 55 commands -> `/api/v1/commands`

```text
publish_policy, threshold, save_catalog, approve_text, approve_content_set,
publish_catalog, translation_correction, profile, activate, switch_role, locale,
bind_contact, new_job, edit_draft, publish_job, link_jobs, initial_offer, message,
revise_price, approve_price, final_application, select_master,
terminate_negotiation, publication_deadline, cash, initiate_payment,
payment_outcome, reservation_deadline, decline_reservation, accept_work,
submit_result, complete, cancel, cancellation_response, open_resolution,
decide_resolution, inspect_resolution, reminders, start_payout, payout_outcome,
start_settlement, settlement_outcome, request_repayment, agree_repayment,
receive_repayment, close_repayment, support, close_support, review, hide_review,
hide_history, preferences, inbox, feedback, evaluate_retention
```

## 15 queries -> `/api/v1/queries`

```text
feed, job, payment, debt, cash_availability, information, published_text,
chat_history, history, reputation, contacts, role_counts, repayment, payout, inbox
```

## 5 methods

```text
login/recover       -> /api/v1/account/access
translateMessage    -> /api/v1/translations/message
draftTranslation    -> /api/v1/translations/draft
dispatchNotification-> /api/v1/notifications/dispatch
```

Automated assertion:

`55 + 15 + 5 = 75`

---

# 17. Shared Contracts

TS + Dart parity.

Must include:

- envelopes;
- 55 command variants;
- 15 query variants;
- 5 method mappings;
- public views;
- decimal money codec;
- validators;
- shared fixtures;
- API error code.

Never export:

- CoreState;
- audit/proof internals;
- receipts;
- secrets;
- server permissions as client authority.

---

# 18. Error model

F2 FailureCode unchanged.

Wire adds only:

```text
BadRequest
UnsupportedMediaType
InfrastructureUnavailable
```

HTTP:

```text
400 bad transport/envelope
401 auth / F2 Unauthorized
404 NotFound
409 Conflict / IdentityOccupied / ClaimConsumed / F2 StaleRevision
415 UnsupportedMediaType
503 RepositoryUnavailable / RepositoryOutcomeUnknown / InfrastructureUnavailable
422 other expected F2 failure
500 programmer failure
```

No stack/provider body/secrets.

F2 detail not public by default.

---

# 19. Authentication/future providers

F3 does not choose product login provider.

Protected routes use opaque bearer + existing AuthenticationPort.

Request body cannot be authority for:

```text
userId
role
permissions
admin
scheduler
provider identity
```

Controlled adapters allowed only in tests.

Production without future providers fails closed.

Do not implement unused `AccountReadPort` merely for completeness.

Do not invent production:

- payment provider;
- notification provider;
- admin directory;
- legal-retention provider.

---

# 20. Address/privacy

Structured job address:

- stays structured;
- never goes to TranslationPort/Typhoon;
- visibility only from accepted Application view.

Phone/e-mail/contacts:

- not chat fields;
- not translation payload;
- only authorized contacts query.

---

# 21. Photo boundary

New Application layer only:

```text
photo-ports.ts
photo-service.ts
```

`PhotoApplicationService`:

```text
store
read
```

Uses:

```text
PhotoMetadataStorePort
PhotoObjectStorePort
ImageProcessorPort
```

F2 PhotoMetadataPort unchanged.

---

# 22. Photo flow

Upload:

```text
auth
-> business-ref access
-> decode/process
-> private R2 create-if-absent
-> D1 photo_metadata + success receipt
-> response
```

If R2 succeeded and D1 failed:

- orphan not business-visible;
- retry same photoId/digest completes registration.

Job draft:

- may exist before photos;
- photo attaches to existing job;
- `publish_job` performs F2 photo lookup;
- no future-job reservation.

Business refs:

- `profile`: owner/admin read in F3;
- `job`: existing job + lawful party;
- `chat`: existing thread + participant/admin.

Message command remains final authority whether a photo is allowed in current chat mode.

---

# 23. Images + R2

Images:

- validate actual image;
- current input-capability guard;
- orientation correction;
- EXIF/GPS removal;
- one optimized copy;
- initial WebP output;
- stored bytes <= D1 setting;
- no original;
- no permanent variants.

R2:

- private;
- object key derived from photoId;
- create-if-absent;
- technical reconciliation metadata allowed;
- D1 remains business metadata source;
- PhotoMetadataPort lookup requires D1 + actual R2 `head`.

---

# 24. Text Safety

Local, before every external detect/translate.

Categories:

```text
contact
address
account_identifier
personal_data
```

Result:

```text
allowed + null reason
rejected + reason
unknown + null reason
```

Unknown => zero external call.

Digits alone allowed; tests include THB, dimensions, quantity, date/time.

Exact-payload rule: external provider receives exactly inspected text.

---

# 25. Typhoon

```text
base:  https://api.opentyphoon.ai/v1
model: typhoon-v2.5-30b-a3b-instruct
auth:  Bearer secret
mode:  non-streaming
client: direct fetch
```

Do not re-select provider/model.

Regression:

```text
TH->RU, RU->TH, TH->EN, EN->TH, RU->EN, EN->RU
```

Check:

- non-empty;
- no service commentary;
- numeric fidelity;
- terminology fixtures;
- original unchanged;
- safety reject/unknown => zero call.

CI uses controlled HTTP fixture.

Final candidate includes separate real Typhoon probe using existing secret and synthetic/non-personal text.

Hosted legal/commercial review remains deployment gate, not F3 blocker.

---

# 26. Worker Clock

```text
now() -> integer Unix seconds
add(seconds) -> exact
add(days) -> value*86400
add(years) -> UTC calendar-year
```

No 365-day year approximation.

---

# 27. Обязательная последовательность выполнения и самоприёмки

SOL обязан работать в следующем порядке.

## 27.1. PRE-F3 baseline gate

До первой реализации F3:

- собрать baseline commit;
- выполнить полный F1/F2 regression;
- выполнить architecture guards;
- проверить Shared Contracts TS/Dart;
- проверить Node `/health`;
- подтвердить отсутствие новых skips/todos и скрытых failures.

Результат:

`PRE_F3_BASELINE = PASS`

Если baseline не проходит, SOL не начинает F3 до локализации причины. Старый дефект нельзя маскировать изменениями F3.

## 27.2. Реализация F3

SOL реализует весь утверждённый объём F3 и выполняет targeted + regression tests по мере изменений.

F3 подключает F1/F2, но не смешивает этапы и не переписывает их принятую семантику.

## 27.3. Самостоятельная приёмка F3 глазами заказчика

После завершения реализации SOL обязан прекратить режим разработчика и провести отдельную полную приёмку F3 как независимая принимающая сторона.

Он обязан:

- проверить весь F3 по настоящему контракту;
- пройти все операции, негативные сценарии, ошибки, restart/replay/concurrency и security boundaries;
- искать не только падающие тесты, но и пропуски требований, неправильные допущения и слабые места интеграции;
- проверить фактические доказательства, а не доверять результатам разработки;
- сформировать единый корректирующий реестр найденных дефектов;
- устранить все найденные implementation defects;
- повторить targeted проверки;
- затем повторить полную самостоятельную приёмку F3 с начала.

Нельзя передавать владельцу промежуточные порции найденных дефектов.

Результат допускается только:

`SOL_F3_SELF_ACCEPTANCE = PASS`

при:

`OPEN_IMPLEMENTATION_DEFECTS = 0`

## 27.4. Сквозной проход F1+F2+F3

Только после `SOL_F3_SELF_ACCEPTANCE = PASS` SOL выполняет отдельный end-to-end проход всего backend foundation:

`F1 -> F2 -> F3`

Проверяется совместная работа:

- F1 architecture/transport foundation;
- F2 Domain/Application/business rules;
- F3 Worker/D1/API/Infrastructure;
- Node и Worker parity;
- persistence/restart/replay;
- Shared Contracts -> Transport -> Application -> Domain -> D1 -> response;
- ошибки на границах;
- отсутствие обратных зависимостей;
- отсутствие регрессии F1/F2.

Это **не объединение этапов в один слой**. F1, F2 и F3 остаются отдельными архитектурными частями с собственными границами.

Результат:

`F1_F2_F3_END_TO_END = PASS`

Если найден дефект:

1. определить первопричину;
2. исправить весь связанный механизм;
3. повторить targeted tests;
4. повторить самостоятельную приёмку затронутого F3;
5. повторить полный F1+F2+F3 проход.

## 27.5. Условие передачи владельцу

SOL имеет право передать кандидат только при одновременном наличии:

```text
PRE_F3_BASELINE = PASS
SOL_F3_SELF_ACCEPTANCE = PASS
OPEN_IMPLEMENTATION_DEFECTS = 0
F1_F2_F3_END_TO_END = PASS
```

После этого кандидат передаётся владельцу на отдельную независимую приёмку.

---

# 29. CI, integration и реальные provider-прогоны

## 27.1. Обязательный deterministic CI — без внешних credentials

SOL обязан полностью выполнить без Cloudflare account access и без реальных provider secrets:

- Node build;
- Worker build/typecheck;
- `wrangler types --check`;
- Shared Contracts TS/Dart;
- full F1/F2 regression;
- F3 architecture;
- local D1 migration/schema;
- local D1 AtomicRepository;
- HTTP parity with controlled ports;
- photo service contract tests with controlled object/image adapters;
- Text Safety;
- Typhoon protocol tests against controlled HTTP fixture;
- Clock.

Отсутствие Cloudflare/Typhoon credentials не является основанием остановить реализацию, запросить пароль/токен у владельца или не передать полностью реализованный кандидат.

## 27.2. Реальные Cloudflare/Typhoon probes

SOL выполняет реальные provider-прогоны **только если** необходимые credentials уже доступны ему безопасным способом в его среде выполнения без участия владельца.

SOL запрещено:

- запрашивать у владельца пароль Cloudflare;
- запрашивать API key в чате;
- требовать интерактивный login владельца;
- помещать credentials в source, docs, test fixtures или evidence package;
- считать отсутствие credentials дефектом реализации.

Если credentials SOL недоступны, он обязан:

1. полностью завершить реализацию;
2. подготовить готовые reproducible probe scripts/tests для:
   - Worker;
   - D1;
   - private R2;
   - Images;
   - Typhoon six-direction regression;
3. доказать их deterministic contract behavior на controlled adapters;
4. передать кандидат без отметки PASS реальных внешних probes;
5. явно отметить только:
   `REAL_PROVIDER_PROBES = OWNER_ACCEPTANCE_PENDING`.

После передачи кандидата реальные Cloudflare/Typhoon probes выполняются в **независимой приёмке владельца** на уже авторизованной среде и с существующим Typhoon key.

Только synthetic/non-personal data разрешены для реальных probes.

Mock/controlled adapter подтверждает реализацию контракта, но не заменяет реальную provider-проверку в итоговой OWNER acceptance.

---

# 29. Architecture guards

Prove accepted Domain/Application do not import/use:

```text
D1Database
R2Bucket
Cloudflare
Wrangler
Request/Response
fetch
Node runtime
Date
```

Transport may import Contracts + Application only; no concrete D1/R2.

Shared Contracts never import Backend internals.

Worker types stay in Worker/infrastructure compile path.

---

# 30. Acceptance matrix

| Area | Mandatory PASS evidence |
|---|---|
| D1 | 35 tables; STRICT; exact constraints; finance outside jobs; linked-job UQ; one current catalog; one payout/job; bigint/NULL/order round-trip; 50+ categories; FK check |
| Atomic | detached read; access-first replay; success-only receipt; reject/return replay; conflicts; zero writes on Domain failure; batch rollback; concurrency; restart; ambiguous ack; claimDelivery one winner |
| API | 75/75 mapping; Node/Worker parity; health; 400/401/404/405/409/415/422/503/500 mapping; bigint wire; no internal leak; unchanged address/contact access; idempotency |
| Photos | valid/invalid/oversize; EXIF/GPS; orientation; size limit; one R2 copy; no original; retry/conflict; orphan recovery; no false present; access read |
| Safety/Translation | TH/RU/EN safety; blocked categories; unknown; numeric controls; exact payload; six Typhoon directions; timeout/malformed/rate limit; original immutable |
| Regression | all existing F1/F2 tests PASS unchanged; no hidden skip/todo; F3 suite PASS |
| Portability | Node path works; Worker path works; CI from clean checkout; no station path/tool dependency |

---

# 31. Порядок работы SOL

```text
1 PRE-F3 baseline gate
2 Worker tooling/types
3 D1 migration/schema
4 codec/projection/round-trip
5 AtomicRepository
6 Transport + Node/Worker
7 Shared Contracts 75/75
8 photo/R2/Images
9 Text Safety
10 Typhoon
11 Worker Clock
12 architecture guards
13 full F1/F2 regression
14 local F3 integration
15 prepare real-provider probe scripts
16 run real probes only if credentials are already safely available
17 SOL independent F3 self-acceptance as customer
18 fix every found defect
19 repeat full F3 self-acceptance
20 full F1+F2+F3 end-to-end pass
21 final evidence audit
22 one candidate package
```

Не передавать известные дефекты частями.

Исправление любого дефекта => targeted retest + full affected regression + final full suite.

---

# 32. Поставка SOL

Один законченный пакет.

Минимум:

```text
F3_FINAL_REPORT.md
F3_TRACE_MATRIX.md
F3_TEST_REPORT.md
F3_SELF_ACCEPTANCE.md
F1_F2_F3_END_TO_END.md
F3_PROVIDER_PROBES.md
F3_SOURCE_MANIFEST.sha256
```

Trace matrix:

```text
requirement
× operation/scenario
× conditions
× dependencies
× expected
× actual test/evidence
× status
```

Report includes:

- baseline commit;
- candidate source hash;
- changed/new files;
- migration hashes;
- 35-table/constraint inventory;
- F1/F2 counts;
- F3 counts;
- real provider probe evidence **если credentials были безопасно доступны SOL**;
- иначе prepared probe manifest/scripts + `REAL_PROVIDER_PROBES = OWNER_ACCEPTANCE_PENDING`;
- unresolved implementation defects = 0.

Отсутствие credentials не считается implementation defect.

No PASS without evidence.

---

# 33. Критерий передачи владельцу

Candidate SOL готов к передаче владельцу, когда одновременно:

```text
PRE_F3_BASELINE = PASS
original F3 tasks implemented
Domain independent of Worker/D1
35-table schema reproducible
migrations reproducible
AtomicRepository proven
75/75 API mapped
Worker/Node parity proven
R2/Images contract proven deterministically
Text Safety proven
Typhoon adapter regression proven deterministically
Worker Clock proven
full F1/F2 regression PASS
F3 full deterministic suite PASS
SOL_F3_SELF_ACCEPTANCE = PASS
OPEN_IMPLEMENTATION_DEFECTS = 0
F1_F2_F3_END_TO_END = PASS
legacy not copied
future-stage behavior not invented
evidence package complete
real provider probe scripts prepared
```

Если реальные credentials были безопасно доступны SOL, он дополнительно прикладывает фактические provider-probe результаты.

Если credentials не были доступны:

`REAL_PROVIDER_PROBES = OWNER_ACCEPTANCE_PENDING`

и это **не блокирует передачу SOL candidate**.

При этом итоговый статус F3 у владельца остаётся OPEN до нашей независимой реальной проверки Cloudflare/Typhoon.

До OWNER acceptance:

`F3_OWNER_ACCEPTANCE = OPEN`

---

# 34. Трассировка исходного плана

| Исходный F3 | R9.1 |
|---|---|
| Cloudflare Worker | §§5–6, 14–19, 27–28 |
| D1 adapter | §§7–13 |
| migrations | §13 |
| API | §§14–20 |
| persistence adapters | §§7–13, 21–23 |
| error handling | §§18–25 |
| Domain не зависит от Worker/D1 | §§1–5, 28 |

Все строки обязательны.

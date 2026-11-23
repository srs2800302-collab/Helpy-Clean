# HELPY — F3 Backend + Database
## Исполнительский контракт

**Редакция:** R9.4 — согласованы исходная схема D1, адресная проекция и защита контактов; разрешена точечная корректировка существующего кода F2

**Дата:** 2026-11-23

**Статус:** DOCUMENT GATE — кандидат на утверждение владельцем; корректировка существующего кандидата F3 и последующая полная приёмка

**Предыдущая редакция:** R9.3 (локально зафиксирована; сохранена как исходная база)

**Baseline F2:** `5eb1e095f77d63e9dbb0f08077ba4681e37d5f0c`

**F2:** OWNER_ACCEPTANCE=ACCEPT, OPEN_IMPLEMENTATION_DEFECTS=0

**Цель:** привести существующий кандидат F3 в соответствие с согласованными решениями и передать один законченный кандидат с доказательствами.

**Назначение редакции R9.4:** F3 уже реализован в существующем кандидате. Эта редакция не разрешает повторную разработку F3 с нуля и не заменяет исходную реализацию. SOL проверяет и корректирует существующий кандидат только в пределах согласованных изменений D1, адресов и контактной защиты, включая прямо разрешённые локальные изменения F2 по §3. После корректировок выполняется полная самостоятельная и независимая приёмка всего F3 с регрессионной проверкой F1/F2.

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

# 3. Границы изменений и разрешённая точечная корректировка F2

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

Принятый F2 R35 остаётся нормативной и архитектурной базой. Его бизнес-правила, операции и инварианты не переоткрываются и не перепроектируются.

**Единственное разрешение владельца на локальное изменение существующего кода F2 в рамках F3 R9.4:** SOL разрешается внести только следующие связанные изменения.

**3.1. Разделение адреса в существующей модели заказа**

- добавить `publicAddress` (район и улица) в существующие `Job.draft` и `JobScopeSnapshot`;
- сохранить `address` как полный адрес;
- передать оба значения через существующие операции `new_job` и `edit_draft`, формирование снимка при `publish_job`, существующие Query/представления и Shared Contracts;
- обновить только непосредственно связанные валидаторы, сериализацию/восстановление и тестовые данные;
- использовать существующий `jobs.job_payload` для сохранения обоих значений. Новая таблица, отдельная Address-сущность и отдельные колонки D1 не создаются.

**3.2. Передача существующего контекста Text Safety**

- существующий `TextSafetyPurpose` уже содержит `job_chat` и `external_translation`; использовать эти значения без добавления новых типов назначения;
- для Client–Master job chat передавать `job_chat` при проверке перед сохранением, внешнем `detect` и внешнем `translate`;
- для Support Chat и существующей операции Admin draft сохранять действующее назначение `external_translation` и их прежнюю семантику;
- разрешается изменить только передачу этого существующего значения через `ProtectedTranslation` и непосредственно связанные вызовы. Новый порт, Application gate, сервис, FailureCode или отдельное ядро чата не создаются.

**Разрешённая поверхность кода F2 ограничена следующими существующими файлами:**

```text
apps/backend/src/domain/marketplace.ts
apps/backend/src/application/validation.ts
apps/backend/src/application/domain-core.ts
apps/backend/src/application/queries.ts
apps/backend/src/application/text-safety.ts
packages/contracts/src/index.ts
packages/contracts/lib/src/f3_api.g.dart (только результат штатной генерации)
непосредственно связанные F2 tests и fixtures
```

В `Command` разрешено только добавить `publicAddress` в payload существующих `new_job` и `edit_draft`; новые операции не добавляются. В существующие Query/Shared Contracts разрешено добавить поле публичного адреса в представления заказа и ленту. Верхнеуровневая структура `CoreState`, `FailureCode`, права доступа и бизнес-переходы не меняются.

Любое изменение F2 за пределами этого списка запрещено без отдельного решения владельца. После точечной корректировки обязательны целевые тесты изменённых путей и полный F1/F2 regression. Это не повторная разработка и не новое полное принятие F2.

Все остальные изменения F2 запрещены, в том числе изменения:

- финансовых, платёжных и долговых правил;
- жизненного цикла заказа и чата;
- каталога, публикации, предложений и назначения мастера;
- Resolution, отзывов, уведомлений и retention;
- авторизации и полномочий, кроме использования уже существующих проверок.

Разрешены только новые файлы Application для границы работы с медиа в исходном объёме F3. Новый Application gate для адресов или Text Safety не создавать.

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

## Разрешённая точечная корректировка существующего F2

Только в пределах разрешения §3:

```text
apps/backend/src/domain/marketplace.ts
apps/backend/src/application/validation.ts
apps/backend/src/application/domain-core.ts
apps/backend/src/application/queries.ts
apps/backend/src/application/text-safety.ts
packages/contracts/src/index.ts
packages/contracts/lib/src/f3_api.g.dart (генерируемый файл)
непосредственно связанные F2 tests и fixtures
```

## Исправить в существующем кандидате F3

```text
apps/backend/migrations/0001_f3_base.sql
apps/backend/src/infrastructure/d1/d1-projection.ts
apps/backend/src/infrastructure/text-safety/local-text-safety.ts
apps/backend/test/f3-d1-schema.test.mjs
apps/backend/test/f3-text-safety.test.mjs
связанные F3 tests и fixtures
```

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

# 5. Граница сборки

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

# 6. Привязки Worker

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

# 8. Физическая схема — 35 таблиц

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
| 12 | `jobs` | `job_id TEXT PK`; `client_id TEXT FK users`; `state TEXT CK F2 states`; `selected_master_id TEXT NULL FK users`; `selected_chat_id TEXT NULL`; `resolution_id TEXT NULL`; `linked_job_id TEXT NULL FK jobs`; `accepted_at/acceptance_operation_id/completed_at/last_activity_at NULL`; `job_payload TEXT` (включает `draft`/`snapshot` с `publicAddress` и `address`); partial UQ on non-null `linked_job_id` |
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
| 29 | `reviews` | `review_id TEXT PK`; `job_id TEXT UQ FK`; `client_id/master_id FK`; `stars INTEGER CK 1..5`; `marks_payload`; `comment`; `created_at`; `hidden CK 0/1`; `moderation_payload NULL`; **без `extra_payload` и иных generic extension payload** |
| 30 | `hidden_history` | `user_id TEXT FK`; `role TEXT CK client/master`; `job_id TEXT FK`; PK `(user_id,role,job_id)` |
| 31 | `domain_events` | `event_id TEXT PK`; `event_sequence INTEGER UQ CK>=0`; `operation_id`; type/subject/actor/time; recipients/roles/facts/context/proof/timers/retentions payloads; `policy_version NULL FK`; order only by sequence |
| 32 | `notification_preferences` | `user_id TEXT`; `role TEXT CK client/master/admin`; events/channels payloads; `sound_requested CK 0/1`; PK `(user_id,role)`; **без `role_present`; сохранённая роль обязательна и восстанавливается из составного ключа** |
| 33 | `deliveries` | `delivery_id TEXT PK`; `event_id TEXT FK`; recipient/role/channel; `attempt INTEGER CK>0`; `status TEXT CK requested/pending/delivered/failed`; UQ `(event_id,recipient_id,channel)` |
| 34 | `retention_records` | `fact_id TEXT`; `record_kind TEXT CK current/origin`; `kind TEXT CK communication/evidence/financial/audit/account`; `anchor NULL`; `anchor_kind CK completed/recorded`; `deadline NULL`; `policy_version FK`; PK `(fact_id,record_kind)` |
| 35 | `photo_metadata` | `photo_id TEXT PK`; `owner_id TEXT`; `format TEXT`; `business_ref_kind TEXT CK profile/job/chat`; `business_ref_id TEXT`; `present CK 0/1` |

**Финансы физически отсутствуют в `jobs`.**

Вложенные structures без самостоятельного lifecycle отдельной table не получают.

---

# 9. Порядок, который обязан пережить перезапуск

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

# 10. Кодек и проекция

Единый F3 codec обязан:

- bigint <-> decimal TEXT;
- сохранить NULL/absence distinction;
- сохранить array order;
- проверять codec version;
- reject malformed/unknown payload;
- не сохранять неизвестные свойства Review в `extra_payload`: проекция Review содержит только поля принятой модели F2;
- не сохранять `NotificationPreference.role_present`: после нормализации существующей операцией F2 роль обязательна и восстанавливается из ключа `(user_id, role)`;
- при восстановлении NotificationPreference всегда включать роль, полученную из составного ключа, и проверять эквивалентность через F2 `sameFact`;
- сохранять `publicAddress` и полный `address` в составе существующего `jobs.job_payload` и подтверждать их round-trip;
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

# 11. Атомарный репозиторий (`AtomicRepository`)

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

## Защита ревизии

Успешные вызовы `transact` и `claimDelivery` увеличивают общую ревизию на 1.

Guard:

```sql
UPDATE repository_meta
SET revision = revision + 1, commit_token = :token
WHERE id='core'
  AND revision=:expected_revision
  AND codec_version=:codec_version;
```

Проверка перед завершением транзакции:

```sql
UPDATE repository_meta
SET revision = CASE WHEN commit_token=:token THEN revision ELSE -1 END
WHERE id='core';
```

Ограничение `revision CHECK >=0` обеспечивает откат попытки с устаревшей ревизией.

Then:

```sql
UPDATE repository_meta
SET commit_token=NULL
WHERE id='core' AND commit_token=:token;
```

Устаревшая ревизия вызывает внутренний повтор, а не ошибку F2 `StaleRevision`.

Количество повторов ограничено, документировано и проверено нагрузочными испытаниями. Исчерпание повторов означает ошибку уровня репозитория.

При неоднозначном подтверждении записи выполняются контрольное чтение и проверка квитанции; ручное частичное исправление запрещено.

## `claimDelivery`

Only:

`requested -> pending`

Применяется та же защита ревизии.

Из параллельных вызовов значение `true` получает ровно один.

Неопределённый результат после перехода в `pending` не приводит к автоматической повторной отправке.

---

# 12. Квитанции и идемпотентность

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

Одинаковый ключ при другом акторе, подписи или содержимом приводит к `Conflict`.

Большой результат может занимать несколько строк квитанции; вторую таблицу квитанций не создавать.

---

# 13. Миграции

Required:

`apps/backend/migrations/0001_f3_base.sql`

Creates:

- ровно 35 таблиц HELPY;
- все ограничения целостности;
- `repository_meta/core`;
- версия кодека;
- `maxStoredPhotoBytes=1572864`.

Не заполняет начальными данными:

- производственные Policy;
- производственный Catalog;
- пилотные категории;
- пользователей и заказы;
- провайдеров.

Тестовые Policy/Catalog используются только как fixtures.

Владелец подтвердил: `0001_f3_base.sql` **не применялась ни к одной постоянной D1**. Постоянная база ещё не разворачивалась; её создание запланировано после готовности и приёмки кандидата F3.

Поэтому `0001_f3_base.sql` исправляется непосредственно как исходная миграция:

- в `reviews` не создавать `extra_payload`;
- в `notification_preferences` не создавать `role_present`;
- не добавлять последующую миграцию для удаления этих двух колонок;
- не создавать и не разворачивать постоянную D1 до готовности кандидата и отдельного разрешения владельца.

Схема остаётся ровно из 35 HELPY tables. Для `publicAddress` отдельная таблица или колонка не добавляется: оба адресных значения входят в сериализуемый `job_payload` существующей таблицы `jobs`.

Migration acceptance:

- успешное применение к чистой локальной базе;
- детерминированный порядок;
- безопасный повторный запуск через систему миграций;
- неуспешная миграция откатывается целиком;
- в итоговой схеме отсутствуют `reviews.extra_payload` и `notification_preferences.role_present`;
- `foreign_key_check` не обнаруживает нарушений;
- round-trip Review, NotificationPreference и Job snapshot подтверждён через `sameFact`.

---

# 14. Транспорт Worker и Node

`handleHttp()` становится асинхронным Transport, независимым от среды выполнения.

Worker/Node выполняют только следующую передачу:

```text
runtime request
-> HttpRequest
-> handleHttp
-> HttpResponse
-> runtime response
```

В серверных адаптерах не должно быть бизнес-правил, авторизации, SQL или финансовой логики.

Вариант Node сохраняет возможность запуска и использует тот же wire-контракт.

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

Не создавать отдельный маршрут для каждой команды.

Денежные значения в JSON передаются только десятичными строками.

---

# 16. Обязательное покрытие всех 75 операций F2

## 55 команд -> `/api/v1/commands`

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

## 15 запросов -> `/api/v1/queries`

```text
feed, job, payment, debt, cash_availability, information, published_text,
chat_history, history, reputation, contacts, role_counts, repayment, payout, inbox
```

## 5 методов

```text
login/recover       -> /api/v1/account/access
translateMessage    -> /api/v1/translations/message
draftTranslation    -> /api/v1/translations/draft
dispatchNotification-> /api/v1/notifications/dispatch
```

Автоматическая проверка:

`55 + 15 + 5 = 75`

---

# 17. Общие контракты

Совпадение контрактов TypeScript и Dart.

Обязательное содержимое:

- envelopes;
- 55 command variants;
- 15 query variants;
- 5 method mappings;
- public views;
- decimal money codec;
- validators;
- shared fixtures;
- API error code.

Запрещено экспортировать:

- CoreState;
- audit/proof internals;
- receipts;
- secrets;
- server permissions as client authority.

---

# 18. Модель ошибок

`FailureCode` F2 не изменяется.

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

Не возвращать stack trace, тело ответа провайдера или секреты.

Подробности ошибок F2 по умолчанию не раскрываются клиенту.

---

# 19. Аутентификация и будущие провайдеры

В рамках F3 не выбирается провайдер пользовательской аутентификации.

Protected routes use opaque bearer + existing AuthenticationPort.

Тело запроса не является источником полномочий для:

```text
userId
role
permissions
admin
scheduler
provider identity
```

Контролируемые адаптеры разрешены только в тестах.

В production при отсутствии будущих провайдеров операции должны завершаться безопасным отказом.

Не реализовывать неиспользуемый `AccountReadPort` только ради полноты.

Не создавать фиктивные production-реализации для:

- payment provider;
- notification provider;
- admin directory;
- legal-retention provider.

---

# 20. Адресная проекция и защита контактных данных

## 20.1. Два представления адреса в существующей модели заказа

В существующей модели заказа используются два значения:

- `publicAddress` — район и улица, без номера дома, названия кондоминиума/здания, этажа и номера квартиры/комнаты;
- `address` — полный адрес клиента, включая район, улицу, номер дома, название кондоминиума/здания, этаж и номер квартиры/комнаты, если они указаны.

Оба значения отдельно передаются клиентом в существующую заявку и фиксируются в неизменяемом `JobScopeSnapshot` при публикации заказа. `publicAddress` не вычисляется автоматическим разбором `address`; отдельный парсер адресов не создаётся.

До успешного назначения мастера, пока чат имеет временный режим `temporary`, в ленте мастеров, карточке заказа, техническом задании и временном чате мастеру показывается только `publicAddress`. Полный `address` и его закрытые составляющие мастеру не выдаются.

Сам по себе выбор мастера и резервирование заказа (`reserved`) не раскрывают полный адрес. Только после успешного завершения существующего пути оплаты — подтверждённой безналичной оплаты либо явного выбора наличного расчёта — и фактического перехода заказа в `assigned`, а чата в `working`, полный `address` становится доступен назначенному мастеру. Клиент-владелец заказа сохраняет существующий полный доступ к своему адресу. После завершения заказа полный адрес остаётся доступен назначенному мастеру в истории заказа. Отзывать этот доступ после завершения не требуется и запрещено в рамках данной политики. Другие мастера не получают полный адрес. Полномочия Admin не расширяются и остаются такими, какими они определены существующими правилами F2.

Публичная и полная версии адреса проходят через существующие модели, снимок, Query и Shared Contracts. В D1 они сохраняются внутри существующего `jobs.job_payload`; отдельная Address-сущность, таблица или физические колонки не создаются.

Адрес не является запрещённой категорией Text Safety. Адресный текст в сообщении Client–Master job chat разрешён и может переводиться. Структурированные поля адреса карточки заказа отображаются через существующую авторизованную проекцию и не отправляются переводчику отдельным служебным payload.

## 20.2. Контактные данные в карточке заказа и техническом задании

Телефонные номера, email-адреса, контакты мессенджеров и социальных сетей не включаются в карточку заказа и техническое задание и не отображаются в их API-проекциях ни для одной роли и ни на одной стадии заказа, включая стадию после назначения мастера.

Существующие структурированные контакты пользователя и доступ к ним через предусмотренные F2 операции/права не изменяются. Новые способы раскрытия контактов через карточку заказа, техническое задание, ленту или проекцию заказа не добавляются.

## 20.3. Запрет передачи контактов только в заказном чате Client–Master

Правило обхода площадки применяется исключительно к сообщениям между ролями Client и Master в контексте заказа (`context_type=job`) и в обоих режимах одного чата:

- временный чат переговоров (`temporary`);
- постоянный рабочий чат (`working`).

Правило одинаково действует для сообщений обеих сторон. Оно не меняет жизненный цикл чата, его `chat_id`, права участников, порядок назначения мастера или переход из временного режима в рабочий.

В тексте такого чата запрещены только следующие виды контактных данных:

1. телефонные номера (`phone_number`);
2. адреса электронной почты (`email_address`);
3. контакты мессенджеров (`messenger_contact`);
4. контакты социальных сетей (`social_network_contact`).

Покрытие распознавания должно включать, как минимум, WhatsApp, Facebook/Messenger, LINE, Telegram, WeChat, Viber, Signal, Instagram Direct, Snapchat, TikTok Direct Messages, Skype и Discord, а также другие распространённые мессенджеры и социальные сети, через которые можно установить прямой контакт. Список и правила распознавания обновляются в существующем F3-адаптере без изменения бизнес-модели, Shared Contracts или схемы D1.

Блокируется именно действующий контакт: номер телефона, email, имя пользователя/handle, контактный ID, ссылка на профиль, ссылка-приглашение или иной идентификатор, позволяющий связаться с участником вне HELPY. Простое упоминание названия платформы без контактного значения не блокируется. Общий запрет всех URL не вводится; информационные ссылки и ссылки на карту/местоположение не запрещаются только из-за наличия URL.

Адреса никогда не являются запрещённой категорией: район, улица, номер дома/строения, название кондоминиума/здания, этаж, номер квартиры/комнаты, почтовый индекс и географические координаты разрешены в тексте заказного чата и могут переводиться. Обычные числа, суммы в THB, размеры, количество, даты и время не блокируются только из-за наличия цифр. Телефонный номер определяется только при наличии положительных признаков контактного значения; числовая последовательность сама по себе недостаточна.

Если запрещённый контакт обнаружен до приёма сообщения, отклоняется всё сообщение целиком. Не допускается автоматически вырезать контакт и сохранять остаток текста. Отклонённый текст и значение контакта не записываются в `chat_messages`, историю, Domain Events, outbox, audit payload или диагностические журналы. Отказ/неопределённость/ошибка проверки не создают сообщение, уведомление, двусторонность переговоров, изменение таймеров, предложения или другие бизнес-факты. Повтор запроса не обходит проверку. Ретроспективное редактирование или удаление уже сохранённой истории не вводится: правило действует до сохранения нового сообщения.

Перед каждым внешним `detect` или `translate` для сообщения Client–Master job chat повторно проверяется именно тот текст, который будет отправлен провайдеру. Внешний провайдер получает только тот же текст, который прошёл проверку. Проверка полномочий и контекста повторяется непосредственно перед внешним вызовом; результат проверки не разрешает отправку изменённого текста.

Официальный Support Chat между HELPY и Client/Master не подпадает под это правило обхода площадки: проверка контактов для отклонения и сохранения сообщения в Support Chat не добавляется. Сохраняются существующие F2 правила приёма Support-сообщений, перевода и полномочий. Если текст Support Chat не проходит существующую общую проверку внешней передачи, внешний перевод не вызывается, но само сообщение сохраняется. Эта проверка не превращается в запрет сохранения Support-сообщения.

Эта политика не вводит OCR, распознавание контактов на изображениях, сканирование вложений или новую обработку медиа. Существующие правила F2 для фотографий и вложений не меняются.

## 20.4. Разрешённая точечная корректировка F2

Для выполнения настоящего раздела SOL вправе точечно изменить существующий код F2 только в объёме, перечисленном в §3:

- добавить `publicAddress` в `Job.draft` и `JobScopeSnapshot`;
- валидировать оба адресных значения в существующих `new_job`/`edit_draft`;
- копировать оба значения в снимок при `publish_job`;
- возвращать `publicAddress` в существующих представлениях ленты/заказа для мастеров, имеющих право видеть заказ;
- возвращать полный `address` только владельцу-заказчику и назначенному мастеру в состояниях `assigned`, `working`, `client_accepted`, `completed` согласно существующей проверке полномочий;
- передавать существующий `TextSafetyPurpose` в уже имеющийся `ProtectedTranslation`: `job_chat` для заказного чата Client–Master и `external_translation` для существующих контекстов Support/Admin.

Новые Domain Operations, Query types, порты, Application gate, Address-сущности, таблицы D1 и бизнес-правила не добавляются. Контракт F2 R35 и его остальные требования не редактируются.

---

# 21. Граница работы с фотографиями

Создать только следующие файлы слоя Application:

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

`PhotoMetadataPort` F2 не изменяется.

---

# 22. Поток обработки фотографий

Upload:

```text
auth
-> business-ref access
-> decode/process
-> private R2 create-if-absent
-> D1 photo_metadata + success receipt
-> response
```

Если операция в R2 завершилась успешно, а запись в D1 — с ошибкой:

- осиротевший объект не виден бизнес-логике;
- повтор с теми же `photoId` и digest завершает регистрацию.

Job draft:

- может существовать до загрузки фотографий;
- фотография прикрепляется к существующему заказу;
- `publish_job` выполняет проверку фотографий через F2;
- резервирование для будущего заказа не создаётся.

Business refs:

- `profile`: чтение владельцем/Admin в F3;
- `job`: существующий заказ и сторона с соответствующими полномочиями;
- `chat`: существующий чат и его участник/Admin.

Команда сообщения остаётся окончательным источником решения о допустимости фотографии в текущем режиме чата.

---

# 23. Изображения и R2

Images:

- проверять фактический формат и содержимое изображения;
- применять действующую проверку допустимых входных форматов;
- корректировать ориентацию;
- удалять EXIF/GPS;
- создавать одну оптимизированную копию;
- первоначальный формат результата — WebP;
- размер сохраняемых данных не превышает настройку D1;
- оригинал не сохранять;
- постоянные дополнительные варианты не создавать.

R2:

- закрытое хранилище;
- ключ объекта формируется из `photoId`;
- создавать только при отсутствии объекта;
- допускаются технические метаданные для сверки;
- D1 остаётся источником бизнес-метаданных;
- проверка через `PhotoMetadataPort` требует наличия записи в D1 и фактического объекта в R2 (`head`).

---

# 24. Проверка безопасности текста (`Text Safety`)

Проверка выполняется локально на сервере до сохранения сообщения в заказном чате Client–Master и до каждого внешнего `detect`/`translate`. Конкретная область применения определяется существующим `TextSafetyPurpose` и правилами §20.3. Новый порт или отдельный механизм не создаётся.

Для `job_chat` (только Client–Master job chat, режимы `temporary` и `working`) F3-адаптер блокирует только четыре вида контактов из §20.3:

```text
phone_number
email_address
messenger_contact
social_network_contact
```

В существующем типизированном результате F2 используется уже предусмотренная причина `contact`; новые FailureCode и новые значения `TextSafetyReason` не добавляются. Адреса, координаты, суммы, THB, размеры, количества, даты и время разрешены. Общие категории `address`, `account_identifier` и `personal_data` не используются для блокировки обычного текста Client–Master job chat в рамках этой политики.

Для `external_translation` вне Client–Master job chat сохраняются действующие F2 ограничения защиты текста перед внешней передачей, включая существующие проверки контактных/идентифицирующих сведений для Support Chat и Admin draft. Это не является проверкой допуска Support-сообщения к сохранению. Адрес не блокируется и не является причиной отказа внешней передачи текста.

Support Chat не проходит проверку допуска `job_chat`; его сообщения принимаются по существующим правилам F2. Перед внешним переводом применяется существующая граница `external_translation`, без введения новой контактной блокировки при сохранении Support-сообщения. Если текст не проходит эту проверку, перевод не выполняется, но сообщение остаётся в чате. Операция Admin draft также продолжает использовать `external_translation`.

Результат:

```text
allowed + null reason
rejected + reason
unknown + null reason
```

Для `job_chat` результат `rejected` или `unknown` на стадии приёма означает отказ без сохранения сообщения и без бизнес-эффектов. При повторной проверке перед внешним вызовом `rejected`, `unknown`, ошибка или невалидный результат означают ноль внешних вызовов. Для уже сохранённого допустимого оригинала отказ перевода не меняет оригинал и бизнес-состояние.

Для `external_translation` `unknown`, ошибка или невалидный результат не разрешают внешний вызов. Допустимое исходное сообщение не удаляется и не переписывается только из-за недоступности перевода.

Числовые последовательности сами по себе не являются доказательством телефонного номера. Тесты включают THB, размеры, количества, даты, время, номера домов и координаты. Названия мессенджеров без контактного значения не блокируются. Общий запрет URL не вводится.

Текст, прошедший проверку, должен совпадать с фактическим payload внешнего запроса побайтно после согласованной нормализации. Нельзя отправить изменённый или повторно подменённый текст. Оригинал сообщения остаётся неизменным.

Отклонённый заказной текст, контактное значение и исходное сообщение не попадают в историю, Domain Events, outbox, audit payload или логи. Автоматическое удаление/маскирование части сообщения не допускается.

OCR, распознавание контактов в изображениях, сканирование вложений и новые правила медиа не добавляются.

---

# 25. Typhoon

```text
base:  https://api.opentyphoon.ai/v1
model: typhoon-v2.5-30b-a3b-instruct
auth:  Bearer secret
mode:  non-streaming
client: direct fetch
```

Не выбирать провайдера или модель повторно.

Регрессионные направления:

```text
TH->RU, RU->TH, TH->EN, EN->TH, RU->EN, EN->RU
```

Проверить:

- непустой результат;
- отсутствие служебных комментариев;
- сохранение числовых значений;
- тестовые примеры терминологии;
- исходный текст не изменён;
- `rejected`/`unknown` при проверке безопасности означают отсутствие внешнего вызова.

В CI используется контролируемый HTTP fixture.

В итоговый кандидат включается отдельный реальный тест Typhoon с использованием уже доступного секрета и синтетического текста, не содержащего персональных данных.

Юридическая и коммерческая проверка размещённого сервиса остаётся условием развёртывания, но не блокирует завершение F3.

---

# 26. Часы Worker

```text
now() -> integer Unix seconds
add(seconds) -> exact
add(days) -> value*86400
add(years) -> UTC calendar-year
```

Не использовать приближение года как 365 дней.

---

# 27. Обязательная последовательность корректировки и самоприёмки

SOL обязан работать в следующем порядке. Настоящая редакция применяется к уже существующему кандидату F3; повторно создавать F3 с нуля запрещено.

## 27.1. Предварительная проверка baseline F3

До корректировок:

- зафиксировать идентичность существующего F3-кандидата: baseline commit, текущий HEAD, source manifest и SHA-256;
- сохранить текущее рабочее дерево и все существующие изменения; не заменять кандидат содержимым ветки `main`;
- подтвердить принятый F2 baseline и выполнить полный F1/F2 regression;
- выполнить architecture guards;
- проверить Shared Contracts TS/Dart;
- проверить Node `/health`;
- подтвердить отсутствие новых skips/todos и скрытых failures.

Результат:

`PRE_F3_BASELINE = PASS`

Если baseline не проходит, SOL не начинает F3 до локализации причины. Старый дефект нельзя маскировать изменениями F3.

## 27.2. Корректировка существующего F3-кандидата

SOL не реализует F3 заново. Сначала сопоставляет фактический код существующего кандидата с настоящим контрактом и реестром замечаний второй независимой приёмки.

Исправляются только согласованные расхождения:

1. D1: убрать две лишние колонки `reviews.extra_payload` и `notification_preferences.role_present` из ещё не применённой исходной миграции и привести существующий `d1-projection.ts` к принятой модели F2;
2. адрес: реализовать `publicAddress` и полный `address` в пределах точечного разрешения §3;
3. контакты: скорректировать существующий `LocalTextSafety` и его тесты по §20/§24, не создавая нового Application gate;
4. сохранить остальные уже реализованные механизмы F3 без переписывания.

F3 подключает F1/F2, но не смешивает этапы и не переписывает принятую семантику F2. Любое изменение F2 допустимо только в точных пределах §3. Изменения за этими пределами требуют отдельного решения владельца.

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

# 28. CI, интеграция и реальные проверки провайдеров

## 28.1. Обязательный детерминированный CI — без внешних учётных данных

SOL обязан полностью выполнить следующие проверки без доступа к аккаунту Cloudflare и без реальных секретов провайдеров:

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

## 28.2. Реальные проверки Cloudflare/Typhoon

SOL выполняет реальные проверки провайдеров **только если** необходимые учётные данные уже безопасно доступны в его среде выполнения без участия владельца.

SOL запрещено:

- запрашивать у владельца пароль Cloudflare;
- запрашивать API key в чате;
- требовать интерактивный вход владельца;
- помещать учётные данные в исходный код, документацию, тестовые fixtures или пакет доказательств;
- считать отсутствие credentials дефектом реализации.

Если credentials SOL недоступны, он обязан:

1. полностью завершить реализацию;
2. подготовить готовые к повторному запуску probe scripts/tests для:
   - Worker;
   - D1;
   - private R2;
   - Images;
   - Typhoon six-direction regression;
3. доказать детерминированное соответствие контракту на контролируемых адаптерах;
4. передать кандидат без отметки PASS реальных внешних probes;
5. явно отметить только:
   `REAL_PROVIDER_PROBES = OWNER_ACCEPTANCE_PENDING`.

После передачи кандидата реальные проверки Cloudflare/Typhoon выполняются в **независимой приёмке владельца** на уже авторизованной среде и с существующим ключом Typhoon.

Для реальных проверок разрешены только синтетические данные, не содержащие персональных сведений.

Mock/controlled adapter подтверждает соответствие реализации контракту, но не заменяет реальную проверку провайдера в итоговой OWNER acceptance.

---

# 29. Архитектурные ограничения

Доказать, что принятые Domain/Application не импортируют и не используют:

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

Transport может импортировать только Contracts и Application; прямой импорт конкретных реализаций D1/R2 запрещён.

Общие контракты никогда не импортируют внутренние компоненты Backend.

Типы Worker остаются в контуре компиляции Worker/infrastructure.

---

# 30. Матрица приёмки

| Область | Обязательные доказательства PASS |
|---|---|
| D1 | Ровно 35 таблиц; `STRICT`; точные ограничения; финансы вне `jobs`; linked-job UQ; одна текущая редакция каталога; один payout/job; round-trip bigint/NULL/порядка; 50+ категорий без миграции; `foreign_key_check`; в `reviews` нет `extra_payload`; в `notification_preferences` нет `role_present`; роль восстановлена из `(user_id,role)`; Review и NotificationPreference проходят `sameFact` round-trip |
| AtomicRepository | detached read; access-first replay; success-only receipt; reject/return replay; conflicts; zero writes on Domain failure; batch rollback; concurrency; restart; ambiguous ack; один победитель `claimDelivery` |
| API и адрес | 75/75 mapping; Node/Worker parity; health; корректные HTTP-коды; bigint wire; отсутствие внутренних данных; idempotency; `publicAddress` содержит только район и улицу и доступен мастерам, имеющим право видеть заказ; до назначения полный `address` скрыт; после назначения полный адрес доступен назначенному мастеру; полный адрес остаётся в истории после завершения; права клиента и Admin не расширены; контакты не раскрываются в карточке/ТЗ |
| Контактная защита | обе стороны и оба режима заказного чата Client–Master; телефон, email, WhatsApp, Facebook/Messenger, LINE, Telegram, WeChat и остальные платформы из §20.3; действующие имена пользователей, идентификаторы, ссылки на профили и приглашения; простые упоминания платформ разрешены; адреса/координаты разрешены и переводимы; нет ложных блокировок THB, размеров, количеств, дат, времени и адресных чисел; `rejected`/`unknown` до сохранения не создают сообщение и бизнес-эффекты; контакты не попадают в историю или Typhoon; Support Chat не получает блокировку при приёме сообщения; Admin draft и существующая внешняя защита сохранены; доказаны точное совпадение проверенного и отправленного текста и повторная проверка полномочий |
| Фото и R2 | valid/invalid/oversize; EXIF/GPS; orientation; size limit; one R2 copy; no original; retry/conflict; orphan recovery; no false present; access read; нет OCR и новых проверок контактов в изображениях |
| Text Safety/Translation | TH/RU/EN; `job_chat` и `external_translation` применяются по правильному контексту; четыре категории контактов для заказного чата; адрес не блокируется; `unknown`/ошибка/невалидный результат не разрешают внешний вызов; проверка ложных срабатываний на числах; точное совпадение payload; шесть направлений Typhoon; timeout/malformed/rate limit; неизменность оригинала |
| Регрессия | все существующие F1/F2 tests PASS с обновлением только непосредственно затронутых fixtures; полный F1/F2 regression PASS; нет скрытых skip/todo; полный F3 suite PASS |
| Переносимость | Node path работает; Worker path работает; CI из чистого checkout; нет зависимости от путей/инструментов конкретной станции |

---

# 31. Порядок работы SOL

```text
1. Зафиксировать идентичность и контрольные суммы существующего F3-кандидата; сохранить все текущие изменения.
2. Выполнить PRE-F3 baseline gate и подтвердить F1/F2 baseline.
3. Сопоставить исходный код с контрактом только по согласованным группам D1, адреса и контактов.
4. Исправить исходную миграцию 0001_f3_base.sql: убрать reviews.extra_payload и notification_preferences.role_present; проверить отсутствие иных изменений схемы.
5. Исправить существующий d1-projection.ts и доказать round-trip всех затронутых фактов.
6. Внести разрешённую точечную корректировку F2 строго по §3: publicAddress/address и передача существующего TextSafetyPurpose.
7. Исправить существующий LocalTextSafety и связанные F3 tests; не создавать новый Application gate.
8. Выполнить целевые проверки каждого изменения и проверить отсутствие побочных эффектов.
9. Выполнить полную регрессионную проверку F1/F2 и полный детерминированный набор тестов F3.
10. Проверить совместимость Node/Worker, Shared Contracts 75/75, миграции и архитектурные ограничения.
11. Подготовить сценарии реальной проверки внешних провайдеров.
12. Выполнить реальные проверки только если учётные данные уже безопасно доступны.
13. Провести полную самостоятельную приёмку F3 глазами заказчика по всему контракту.
14. Устранить все найденные дефекты и повторить полную самостоятельную приёмку.
15. Выполнить полную сквозную проверку F1+F2+F3.
16. Провести финальный аудит доказательств и подготовить один законченный пакет.
```

Не передавать известные дефекты частями.

После исправления любого дефекта обязательны целевой повторный тест, полная регрессия затронутой области и итоговый полный набор проверок.

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
- контрольные суммы исходного и итогового исходного кода кандидата;
- точный перечень локально изменённых F2-файлов с подтверждением, что изменения не выходят за §3;
- changed/new files;
- migration hashes;
- 35-table/constraint inventory;
- F1/F2 counts;
- F3 counts;
- доказательства реальных проверок провайдеров, **если учётные данные были безопасно доступны SOL**;
- в противном случае — подготовленные манифест и scripts проверок плюс `REAL_PROVIDER_PROBES = OWNER_ACCEPTANCE_PENDING`;
- количество неустранённых дефектов реализации равно нулю.

Отсутствие учётных данных не считается дефектом реализации.

Статус PASS не присваивается без доказательств.

---

# 33. Критерий передачи владельцу

Candidate SOL готов к передаче владельцу, когда одновременно:

```text
PRE_F3_BASELINE = PASS
original F3 tasks implemented
Domain independent of Worker/D1
35-table schema reproducible
reviews.extra_payload absent
notification_preferences.role_present absent
migrations reproducible
publicAddress/address projection proven
Client-Master contact protection proven; Support Chat admission unchanged
F2 local delta limited to §3 and regression PASS
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

Если учётные данные для реальных проверок были безопасно доступны SOL, он дополнительно прикладывает фактические результаты проверок провайдеров.

Если credentials не были доступны:

`REAL_PROVIDER_PROBES = OWNER_ACCEPTANCE_PENDING`

и это **не блокирует передачу SOL candidate**.

При этом итоговый статус F3 у владельца остаётся OPEN до независимой реальной проверки Cloudflare/Typhoon.

До OWNER acceptance:

`F3_OWNER_ACCEPTANCE = OPEN`

---

# 34. Трассировка исходного плана

| Исходный F3 | R9.1 |
|---|---|
| Cloudflare Worker | §§5–6, 14–19, 27–28 |
| Адаптер D1 | §§7–13 |
| Миграции | §13 |
| API | §§14–20 |
| Адаптеры хранения | §§7–13, 21–23 |
| Обработка ошибок | §§18–25 |
| Проекция D1 для Review/NotificationPreference | §§8, 10, 13, 30 |
| адресная проекция и разрешённая точечная корректировка F2 | §§3, 4, 20, 30 |
| контактная защита Client–Master job chat | §§3, 4, 20, 24, 30 |
| Domain не зависит от Worker/D1 | §§1–5, 29 |

Все строки обязательны.

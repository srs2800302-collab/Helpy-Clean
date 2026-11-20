# F2 R35 Implementation Evidence Index

This is an implementation work record, not a normative contract. Authority:
`docs/F2_DOMAIN_CORE_CONTRACT.md`, owner-approved R35, HEAD
`1068bb6b792e4656f348d469dc855737cbf7ce17`. No implementation acceptance is claimed.

## Input Record

- CLEAN_ROOT: `/media/demo/WORKSPACE/Repositories/Helpy-Clean`.
- LEGACY_ROOT: `/media/demo/WORKSPACE/Repositories/Helpy`.
- Initial `git status --porcelain=v1 --branch`: `## main...origin/main [ahead 1]`.
- Registry `git hash-object`: `f8b82b0f82fcf154c448ffb951470488b20c5cb4`.
- Git 2.55.0; Node v24.22.2; npm 11.19.1; existing TypeScript pin 5.9.3.
- Owner explicitly authorized Read for the exact R34 ranges during this session.
- No legacy content outside these ranges was read. No network or subagents used.
- CodeReview `versions`: PASS; rg 15.2.0, Ruff 0.16.8, ast-grep 0.45.3,
  BasedPyright 1.40.1, Semgrep 1.178.0; runtime dependency Node 24.19.0.
- CodeReview baseline backend directory gate: PASS, zero findings, ast-grep and
  Semgrep applied; Python tools skipped (no Python); no TS directory compiler.
- Initial `npm run verify`: builds succeeded; contracts tests 2/2; backend
  reported 3 passing tests and 1 cancelled file with pending-promise diagnostic;
  terminal invocation hit its 120000 ms limit. Not recorded as PASS.

## Source Mapping

All ranges below were read inclusively using Read after blob verification.
Each profile contributes form/evidence data and Client/Master information,
not old implementation or mandatory new workflow steps. RU texts exist;
product TH/EN approval is not evidenced. Fixture languages will be explicitly
test-only. Historical Admin dependencies, qualification gates, ten-photo
hard limits, nested category identity and completion prerequisites are replaced
by F2 sections 1, 2.2, 3, 9 and 10, not unanswered product questions.

| Profile | Registry | Current F2 mapping |
|---|---|---|
| Cleaning regular | 7989-8109 | terminal form, balcony/pets, role rules |
| Cleaning deep | 8110-8240 | terminal form, empty premises, prepared furniture |
| Cleaning post-repair | 8241-8364 | repair-completed stop condition, no repair service |
| AC service | 8503-8597 | count/access, scenario-first service |
| AC install | 8785-8918 | wall/outdoor location, independent service |
| AC replace | 8919-9048 | new/old equipment, independent service |
| Plumbing faucet | 10140-10440 | internal install/replace, location photos |
| Plumbing toilet | 10639-10878 | install/replace only; stored repair branches excluded |
| Plumbing shower | 10441-10638 | equipment readiness, hose question |
| Electrical socket | 9453-9680 | point count distinct from item quantity |
| Electrical switch | 9681-9908 | independent repeatable point |
| Door lock | 11165-11401 | merge two actions into one entity |
| Furniture lock | 11402-11617 | merge two actions into one entity |
| Kitchen assembly | 7305-7413 | structured form, separate linked built-in job |
| Cabinet furniture | 7414-7530 | table, initial 3 rows, unlimited addition |
| Built-in furniture | 7531-7714 | fixed 6 widths/2 heights/6 depths, dependencies |
| Disassembly | 7715-7843 | independent entity/table, initial 3 rows |
| Appliance washer | 714-917 | routing to root built-in category |
| Appliance dishwasher | 918-1117 | routing to root built-in category |
| Appliance disposer | 1118-1312 | sink stop; absent old unit routes to install |
| Built-in sink | 1339-1496 | equipment-scoped action and photos |
| Built-in faucet | 1497-1647 | no duplicate work-type question |
| Built-in heater | 1648-1804 | independent equipment form |
| Built-in disposer | 1805-1977 | independent equipment form |
| Built-in hob | 1978-2141 | electric/induction, equipment form |
| Built-in oven | 2142-2291 | install niche dimensions |
| Built-in microwave | 2292-2440 | install niche dimensions |
| Built-in hood | 2441-2628 | ventilation/filter modes, conditional photos |
| Built-in refrigerator | 2629-2811 | niche/facade dependencies |
| Built-in dishwasher | 2812-3003 | niche/facade dependencies |
| Built-in washer | 3004-3199 | niche/facade dependencies |
| Materials/readiness/result/quality | 3259-3316 | reusable information; F2 two-stage completion wins |
| Global rules 1-7 | 3846-3913 | shared role blocks; immutable scope and one revision |
| Appliance general | 630-668 | shared Master information |
| Built-in architecture | 1313-1338 | equipment-list, per-item scenarios |
| Furniture general | 7228-7247 | information, not added required questions |
| Cleaning general | 7934-7952 | scope/result information, no hardcoded photo cap |
| AC general | 8453-8470 | role information, safe access |
| Electrical Client | 9909-9939 | safe scope/coverage information |
| Electrical Master | 9940-9968 | safe work/result information, no qualification gate |
| Plumbing general | 10054-10098 | shared scope and ownership information |
| Locks general | 11076-11120 | shared compatibility/ownership information |

## Pre-Implementation Norm Index

IDs below are unique within this index. Each semicolon-separated numbered
condition is a distinct norm with suffix `.1`, `.2`, etc. Repeated requirements
in sections 8, 11, 12 and 13 map to these same conditions. Status initially
NOT RUN for every condition. Final evidence must identify actual assertions,
operations, ports, positive/negative tests, commands and exit codes; this plan
alone is not evidence of implementation or completeness.

| ID | Authority | Independent conditions / planned proof |
|---|---|---|
| BND | 1; 8.14; 12.2.6; 14-15 | 1 server TS in existing backend; 2 inward dependencies; 3 no runtime globals in core; 4 no SDK/DB/API/UI; 5 wire types distinct; 6 replaceable ports; 7 no legacy code/history; 8 no station dependency/CI review dependency |
| CAT | 2-2.3; 8.1,3; 10; 12.1 catalog | 1 stable IDs; 2 eight roots; 3 exactly 31 fixture entities; 4 all scenario sets; 5 no repair/dryer/extra points; 6 50+ extension; 7 eight profiles; 8 per-point quantities; 9 per-equipment actions; 10 independent furniture tables; 11 authorized create; 12 edit; 13 publish; 14 disable category descendants; 15 disable entity alone; 16 republish preserves independent disables; 17 remove preserves history; 18 independent orders; 19 invalid links/version rejected; 20 no title switches |
| TXT | 3.1-3.3; 8.2; 12.1 information | 1 separate locale revisions; 2 edit one preserves others; 3 all th/ru/en required; 4 explicit approval exact revision; 5 stale approval rejected; 6 atomic publication; 7 meaning change rechecks all locales; 8 reorder needs no translation; 9 UI availability cannot weaken approval; 10 old publication retained on failure; 11 translator only candidate; 12 no provider for published text; 13 translation failure isolated; 14 meaning-preserving correction explicit; 15 originals/history retained; 16 extensible locales with launch order |
| INF | 3.2; 8.2; 12.1 information | 1 stable versioned blocks; 2 global role rules; 3 entity/scenario rules; 4 deduplicated references; 5 version check; 6 role check; 7 ownership check; 8 disabled/missing links fail; 9 information separate from scope; 10 available before obligation; 11 create/edit/publish/disable/republish/remove/order authorization; 12 snapshot rules immutable; 13 exact ownership wording; 14 addressable source-text exemplars |
| FRM | 3; 8.2; 10; 12.1 forms | 1 zero blocks allowed; 2 required answers; 3 optional skipped; 4 conditional activation; 5 typed answer formats; 6 photo existence/format not truth; 7 configured photo counts; 8 valid root routing without job; 9 washer/dishwasher routes; 10 disposer route; 11 post-repair stop; 12 repeatable typed tables initial three unlimited; 13 fixed 6/2/6; 14 Electrical independent mini scopes; 15 built-in mixed actions; 16 kitchen separate linked job; 17 config authoring access; 18 localized all managed texts |
| ACC | 11.4; 8 models; 12.1 accounts; 13 recovery | 1 Google/email/phone claims via port; 2 stable user ID; 3 login no auto-role; 4 independent profiles; 5 active-role switch; 6 client email/name; 7 client phone/photo optional; 8 master email/phone/name/photo/specializations; 9 no qualification gate; 10 unlinked identity separate user; 11 verified contact binding; 12 uniqueness/no merge; 13 private contacts owner/Admin; 14 address only assigned master; 15 recovery original user and roles; 16 expired/unverified/foreign/reused claim fails; 17 concurrent recovery once; 18 locale independent; 19 Admin counts both roles; 20 separate presence |
| FED | 4.2; 11.3; 12.1 feed | 1 category includes future entities; 2 entity selection does not; 3 empty feed selection; 4 reverse publication time; 5 no language/geo/rating/qualification filters; 6 replaceable policy; 7 refusal streak no eligibility effect; 8 excluded master no re-entry/notification same job; 9 no exact address/contact before assignment |
| PUB | 4.1; 5-5.1; 8.5; 11.1; 12.1 publication/cycles | 1 draft editable; 2 immutable publication snapshot/CEP/photos/catalog/rules; 3 same job across cycles; 4 no published revision even Admin; 5 first deadline or disabled; 6 no initial offers after deadline; 7 one-sided no protection; 8 real two-sided protection; 9 independent parallel chats; 10 first empty terminal; 11 one-sided expiry; 12 protected continue past deadline; 13 no parallel repeat; 14 early finish waits deadline; 15 repeat 12/6/3 continuation from policy; 16 empty repeat terminal; 17 old exchanges not new-cycle protection; 18 deadline idempotent; 19 selection prohibits marketplace return; 20 Admin close one chat audited; 21 no Admin extension; 22 close/select concurrency |
| OFR | 4-4.1; 8.7; 13 | 1 initial price/snapshot/chat binding; 2 initial not final; 3 unchanged CEP final allowed; 4 explicit final confirmation amount/recipient; 5 one changed price; 6 actual discussion required; 7 reason required; 8 cancellation no consumed attempt; 9 successful persistence consumes; 10 client price approval separate; 11 rejection no second revision; 12 final frozen amount; 13 client selection separate explicit confirmation; 14 invalid/closed/expired final unselectable; 15 reserve not assign; 16 close competitors; 17 same chosen chat; 18 structured initial/revised/approved/final/selected events; 19 duplicates no extra effect |
| REF | 4.2; 8.12; 12.1 refusals | 1 close window no domain effect; 2 confirmed termination cancels price/final; 3 no confirmation no mutation; 4 valid master withdrawal one refusal; 5 no active sent offer no refusal; 6 client/admin/timeout no refusal; 7 local job exclusion; 8 no global suspension at any count; 9 first/repeated warnings; 10 durable idempotent basis; 11 concurrent increments once; 12 Resolution refusal only proved; 13 reset only completed; 14 Admin completion same reset; 15 acceptance/inactivity no reset; 16 retain history |
| CHT | 3.3; 5; 8.6,8; 11.3.1; 12.1 chats | 1 one shared port/core for temporary/work/support; 2 participant isolation; 3 original immutable; 4 translation separate/provider-neutral; 5 loaded messages new locale; 6 provider failure no mutation; 7 no temporary photos; 8 scope photos readable; 9 work max one photo/message unlimited messages; 10 work no TTL; 11 closed job read-only; 12 source language from detector not UI; 13 uncertain no guess; 14 notice persists until master reply; 15 changed language updates notice; 16 same language no repeat; 17 window close no transition |
| PAY | 6-6.3; 8.9; 11.2; 12.2.4; 13 E-04 | 1 financial snapshot on selection; 2 one configurable deadline; 3 first terminal failed reset once; 4 subsequent failure no reset; 5 late first failure reset; 6 timely pending preserves reservation; 7 unknown typed needsResolution with operation/deadline; 8 no Cash/switch/second operation while pending; 9 full FAP THB success assignment once; 10 callbacks validate ID/amount/currency/outcome; 11 inconsistent callback no new transfer; 12 Cash enabled and debt below threshold recheck; 13 cancellation only without unresolved operation; 14 timeout terminal no marketplace; 15 no deposit; 16 safe failure reason contract; 17 deadline-derived view; 18 provider policy required distinct timeout |
| MON | 7.1-7.3; 8.10; 11.5 arithmetic; 13 | 1 integer THB explicit; 2 exact rational rates; 3 half-up 0.3/0.5/0.6; 4 subtract remainder; 5 preserve total; 6 immutable FAP/commission/cancellation versions; 7 Cash commission only completed once; 8 no Cash cancel debt; 9 no negative balances; 10 atomic event/ledger; 11 payout identity unique; 12 calculation at completed/current debt; 13 fixed 70%; 14 override forbidden; 15 debt cap; 16 retry no recalc; 17 concurrent payout/repayment no double debt; 18 failure preserves debt recovery/completed; 19 pending retry forbidden; 20 zero shares no external transfer; 21 positive payout verified destination/route; 22 exact 1000/300/400 failed/retry test; 23 net 105/101/1/0 cases |
| DBT | 7; 7.0.1; 8.11; 12.1 debt | 1 global threshold; 2 independent master override; 3 remove override; 4 threshold >= blocks Cash only; 5 preselection noncash-only view; 6 zero debt view; 7 positive whole repayment <= current debt; 8 explicit request confirmation; 9 request unique/admin notification/no ledger; 10 official bound support chat; 11 cash or bank transfer only; 12 no percentage/work-off; 13 Admin explicit actual receipt; 14 exact master/request binding; 15 current debt recheck; 16 mismatch needs explicit revised agreement; 17 receipt once; 18 unresolved/rejected no financial effect; 19 audit/access; 20 future Cash recheck |
| WRK | 9.1; 9.3.1; 9.4; 13 | 1 assignment only paid/Cash; 2 address only after assignment; 3 evidence optional; 4 accept/reject directly assigned/working; 5 rejection explanation/unlimited correction; 6 client accepts then master completes; 7 acceptance holds funds/no Cash debt; 8 active cancellation blocks normal completion; 9 completed closes chat/reset once; 10 no chat-close cancellation; 11 after accepted no ordinary cancellation; 12 completed not reopened; 13 competing completion/Resolution atomic |
| RES | 9.2-9.2.1; 9.4; 13 E-01 | 1 request explicit warning/reason/explanation/evidence; 2 cessation separate financial consent; 3 disputed terms require explanation; 4 no response escalates not agrees; 5 mutual before arrival/no partial snapshot fee; 6 False Call arrival/reason/photos; 7 both snapshot rates; 8 fee then Helpy rounding/master remainder; 9 no extra commission; 10 partial excludes fixed fees; 11 partial remaining work/evidence; 12 pool held minus commission; 13 exact shares sum reject independent-rounding mismatch; 14 Cash no phantom refund/fee/debt; 15 proved master refusal full refund/streak once; 16 unclassified master cancellation pending held no effects; 17 authorized evidence-linked decision; 18 only approved outcome; 19 single terminal allocation; 20 duplicated/conflicting decision/callback no extra effects; 21 immutable evidence/FAP/scope/acceptance; 22 nonzero obligations only; 23 accepted early case pending no effects; 24 threshold alone no completion; 25 Admin accepted completion threshold/proof/audit; 26 unaccepted not exceptionally completed; 27 master/Admin concurrent single completion |
| REP | 9.3.2; 13 | 1 completed owner one review; 2 optional skip no auto review; 3 integer stars 1-5; 4 optional four marks/comment; 5 immediate public no approval; 6 public-only quality/reliability/count; 7 experience all completed; 8 no fabricated zero rating; 9 5/hidden1/4 => 4.5,1/2,2,3; 10 all hidden => no rating experience3; 11 Admin hide with reason/audit; 12 no original edit/delete; 13 public list same visibility; 14 history role/limit; 15 hide only own view; 16 no canonical deletion/stats/feed impact |
| NTF | 11.3; 13 notifications | 1 confirmed business events only; 2 matching available order recipients; 3 offer to client; 4 terminal to client; 5 competitor closure to participants; 6 exclusion on repeated cycles; 7 prefs do not filter feed; 8 delivery attempt/status/port; 9 duplicate delivery bounded/idempotent; 10 no address/foreign conversation leak; 11 Platform Inbox separate; 12 Feedback separate; 13 OS sound no guaranteed behavior; 14 no new channels/marketing |
| SUP | 11.3.1; 8.8; 13 | 1 authorized Admin initiates; 2 Helpy sender verified/audit employee; 3 one user separate support chat; 4 valid debt/Resolution context; 5 own replies only; 6 same translation core; 7 survives job/request closure; 8 explicit open/close/history; 9 no order TTL/photo rules inherited; 10 separate attachment policy/no invented cap; 11 messages never financial commands; 12 addressed notifications; 13 idempotent message delivery |
| POL | 11.5; 12.1 policy; 13 policies | 1 authorized update; 2 immutable versions/effective-time/audit; 3 current policy selection; 4 snapshot at countdown launch; 5 changes not retroactive; 6 new cycle/reset uses new version; 7 no arbitrary maxima; 8 invalid duration zero/negative/fraction; 9 rational rate 0-100 exact; 10 routes known/unique separate payment/payout; 11 empty routes impossible operation; 12 override only threshold; 13 no provider default invented; 14 legal minimum validation |
| RET | 9.3.5; 11.5 retention tests; 13 | 1 communication/evidence 90 days after completed; 2 financial/audit/account independent year/anchor; 3 missing anchor ineligible; 4 cancelled/expired/unresolved no invented anchor; 5 just-before vs deadline; 6 legal hold/minimum; 7 hidden history/review not deletion; 8 policy changes preserve stored retention fact; 9 no physical purge in F2 |
| PRC | 12.2-15 | 1 full source reading; 2 approved roots/blob; 3 existing integration/scripts; 4 preimplementation norm index; 5 evidence per independent condition; 6 positive/negative real test; 7 financial duplicate/concurrency; 8 full local CodeReview results/skips; 9 real build/typecheck; 10 affected F1 regression unchanged tests; 11 Dart checks iff changed; 12 delivery diff/checksums/counts; 13 no commit/push without permission; 14 contract/tools unchanged; 15 no false acceptance |
| DFR | 1; 3.1; 6.1; 7.0.1; 10; 11 | 1 globe/top-right/menu UI deferred; 2 visible payment timer UI deferred with domain deadline/reason; 3 debt home UI deferred with debt/threshold; 4 Admin builders/content/language acceptance stage3; 5 real persistence/providers/transport F3; 6 no fake linguistic/UI/infrastructure PASS |

## Policy Parameter Checklist

Owner-approved addition of 2026-11-18, indexed before its implementation. The
original 399 conditions above/below are retained unchanged; the seven following
conditions implement contract section 11.4.1, not a second normative contract.

| ID | Authority | Independent conditions / planned proof |
|---|---|---|
| OWN | 11.4.1, owner decision 18.11.2026 | 1 own job absent from Master feed; 2 own job has no Master notification; 3 self offer rejected by server; 4 self negotiation/chat rejected by server; 5 self selection/reservation rejected by server; 6 self assignment/payment effects rejected by server; 7 both roles retain independent operation with other users/orders |

Every individual parameter below needs positive/negative UseCase evidence,
Admin access, effective version, new-fact effect and old-fact immutability.
IDs are `CFG.<name>` (not a blanket PASS for an entire row).

`catalog`, `forms`, `information`, `locales`, `initialDuration`, `initialAutoClose`,
`repeatDurations`, `repeatFloor`, `negotiationFirstReminder`,
`negotiationRepeatReminder`, `paymentSelectionTimeout`, `providerConfirmation`,
`clientPaymentRoutes`, `masterPayoutRoutes`, `commission`, `globalDebtThreshold`,
`masterDebtThreshold`, `mutualCancellationFee`, `falseCallFee`,
`falseCallMasterShare`, `cancellationResponse`, `cancellationReminder`,
`inactivityFirstReminder`, `inactivityRepeatReminder`, `inactivityThreshold`,
`historyLimit`, `communicationRetention`, `evidenceRetention`,
`financialRetention`, `auditRetention`, `accountRetention`, `notificationPreferences`.

## Planned Verification

### Correction Completeness Review

The original 406 conditions remain indexed. Independent acceptance exposed
cross-cutting Application obligations that were previously implicit rather
than individually indexed. The following six conditions are extracted from
the existing contract, not new product requirements. The corrected index has
412 conditions: 397 native witnesses and 15 procedural controls. Counts alone
do not establish semantic coverage; see `NORM_RECONCILIATION.md` and the
independent/supplemental regression evidence.

| ID | Authority | Independent conditions / planned proof |
|---|---|---|
| APP | 12.2.1-4; 3.3; 7.1; 9.2.1; 11.4.1 | 1 unsupported runtime command yields typed Failure; 2 unsupported runtime query yields typed Failure rather than success(undefined); 3 active participation authorized before exporting content to external ports and atomically rechecked; 4 saved cross-aggregate relations checked on direct reads and commands/callbacks; 5 provider proof bound to direction/job/obligation/beneficiary/destination with global operation identity; 6 decision evidence exists and belongs to the actual order/case rather than arbitrary references or flags |

Use existing `npm run build`, `npm test`, `npm run verify` and backend workspace
scripts, not a new toolchain. Fake Clock, transactional repository, authenticated
principal, identity, translation, payment and delivery ports. Domain tests assert
stored facts after reloading the repository, rollback, duplicate operation IDs,
concurrent requests and forged role/ownership/provider inputs. Architecture
checks compile internal layers without Node types. CodeReview directory gates
for internal source, backend tests and architecture tests during implementation
and final audit. No Dart changes planned. Final detailed evidence will replace
NOT RUN only after the corresponding assertion has actually executed.

## R35 Text Safety Additions

The original 412 conditions and their identities remain unchanged. The owner
added section 3.3.1, section 5.10 and related section 12/13 requirements on
2026-11-19. These eleven additional conditions extend the index to 423; their
execution witnesses are in `f2-r35-regressions.test.mjs` and
`evidence/r35-native-proofs.json`. The completed repeated whole-source audit is
recorded in R5_AUDIT.md. The generated final trace/summary and sealed manifest,
not this index or intermediate green tests, establish the actual delivery state.

| ID | Authority | Independent conditions / planned proof |
|---|---|---|
| SAF | 3.3.1; 5.10; 12.1 text safety; 13 R35 tests | 1 Client and Master job admission guarded in temporary and working modes; 2 contact/address/account/personal categories refused before message and business effects; 3 independent typed safety with no permitting fallback for absent/unknown/error/invalid inspection and no translator dependency; 4 exact checked text and purpose bound to each invocation, never substituted or reused for another input; 5 all external detect/translate paths guarded including Support, saved messages, locale changes and Admin draft; 6 permitted sending survives blocked/unavailable external detection with unknown language; 7 official Support acceptance does not inherit job-chat prohibition or acquire financial effects; 8 current identity/active role/permission/context/deadline checked after asynchronous safety before export; 9 refusals atomic across full state/receipts and replay/restart/concurrency cannot bypass safety; 10 originals and published editions never redacted/rewritten and draft output remains unapproved; 11 legitimate costs/dimensions/quantities/dates/times not prohibited merely for containing digits |

The real TH/RU/EN recognizer, masked-contact accuracy, actual outbound adapter
and provider diagnostic-data/legal-processing gates remain F3 under DFR.5-6.
Synthetic fake decisions do not certify recognition accuracy or legal approval.

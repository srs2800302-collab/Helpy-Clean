# F1 — технический отчёт

Дата: 2026-11-13.

`IMPLEMENTATION=PREPARED`

`LOCAL_PROJECT_CHECKS=PASS`

`ANDROID_BUILD=BLOCKED`

`GITHUB_ACTIONS=NOT_RUN`

`F1_ACCEPTANCE=PENDING`

F1 не объявлен завершённым. Выполненные локальные проверки не заменяют
обязательный Android build, реальный CI и явную приёмку владельцем.

## Основания И Объём

Прочитаны README и документы `00_DEVELOPMENT_PLAN`,
`01_ARCHITECTURE_PRINCIPLES`, `02_REFERENCE_POLICY`,
`03_REQUIREMENTS_AUTHORITY`, `foundation/F1_SCOPE`.
Дополнительно полностью прочитан станционный документ
`MX_PORTABLE_WORKSTATION_AS_BUILT_ARCHITECTURE_20261023_CODE_REVIEW_FINAL.md`,
включая дополнение Node.js, правила State/Cache/runtime routing и роли
BuildRouter, GOVERNOR и CodeReview.

Требования дополнительно просмотрены через штатный `code-review search`.
Совпадения search являются навигацией по требованиям, а не результатом gate.
Для анализа использовался локальный инструмент владельца
`Tools/CodeReview/bin/code-review`. Субагенты, внешние review-сервисы и
альтернативные review-инструменты не привлекались. Компиляция и тесты
выполнялись штатными средствами создаваемого проекта.

Реализован только F1. Domain Entities/UseCases, Worker, D1, authentication,
Registry, формы, заказы, платежи, chats и production deployment не реализованы.
Структура и принятые в реализации технические решения описаны в
`F1_IMPLEMENTATION.md`; документ и реализация ожидают решения принимающей
стороны, а не считаются автоматически утверждённой архитектурой.

## Реализовано

- Mobile: реальный Flutter `main`, Cubit, GetIt, strict analyzer / Null Safety,
  `fpdart.Either` для ожидаемых ошибок preferences, feature-границы
  `data/domain/presentation` без фиктивной бизнес-логики.
- Backend: TypeScript strict; отдельные Domain/Application/Infrastructure/
  Transport; executable Node adapter; `GET /health`, 404 и 405; штатное
  завершение по SIGTERM. Для smoke-test используется стандартный ephemeral
  `PORT=0`, без фиксированного конфликтующего test port.
- Admin: самостоятельный TypeScript/Vite executable с собственным build,
  tests, dev/preview lifecycle. Продуктовой административной функциональности
  и production authentication нет.
- Shared Contracts: независимые TypeScript и pure Dart wire DTO; общие JSON
  fixtures; единый TH/RU/EN каталог, используемый обоими UI без ручных копий.
- Общая локализация: немедленное переключение любых двух языков в обоих
  направлениях, сохранение locale отдельно от бизнес-данных, диагностика
  повреждённого/недоступного storage; сериализация Mobile preference writes.
- Translation boundary: только provider-independent application port для
  будущего adapter, без подключения сервиса, credentials или chat features.
- Project lifecycle: npm workspaces, manifests, три lock files, стандартные
  build/test команды, проверка import directions, GitHub Actions workflow
  с независимой установкой toolchains и Android debug build.

## Результаты Проверок

Все перечисленные успешные project checks выполнены в основном дереве и
повторно в чистом снимке исходников.

| Проверка | Результат | Доказательство в `evidence/` |
|---|---|---|
| `npm ci` | PASS; lock восстановлен, audit: 0 vulnerabilities | `node-verification.log` |
| `npm run verify` | PASS; три workspace builds и 16 тестов | `node-verification.log` |
| Shared Contracts TS | PASS; 2 теста | `node-verification.log` |
| Backend | PASS; 3 теста, включая отдельный executable process и реальный HTTP | `node-verification.log` |
| Admin | PASS; 9 тестов, включая HTTP-раздачу JS/CSS и DOM localization | `node-verification.log` |
| Архитектурные проверки | PASS; 2 теста, включая отрицательные примеры | `node-verification.log` |
| Dart Contracts lock / format / analyze / test | PASS; 2 теста | `dart-contracts-verification.log` |
| Mobile lock / format / analyze / test | PASS; 10 тестов | `mobile-verification.log` |
| Чистый снимок: Node restore/build/test | PASS; 16 тестов | `clean-source-node.log` |
| Чистый снимок: Dart Contracts restore/analyze/test | PASS; 2 теста | `clean-source-dart-contracts.log` |
| Чистый снимок: Mobile restore/analyze/test | PASS; 10 тестов | `clean-source-mobile.log` |
| SHA256 соответствие проверенных файлов снимка | PASS | `source.sha256`, `clean-source-checksums.log` |
| Android через station BuildRouter | BLOCKED до запуска сборки | `android-build-blocker.log` |
| GitHub Actions | NOT RUN | публикация не разрешена и не выполнялась |

Итого: 28 успешных тестов в основном дереве и те же 28 в чистом снимке.
В Mobile и Admin проверены все шесть направленных переходов TH/RU/EN.
Mobile также проверен на viewport 320x568 и на ошибках storage. Mobile `main`
действительно вызван в headless Flutter test engine с реальным composition
root. Это не запуск APK на Android-устройстве.

### Чистый Снимок

Снимок создан из `git ls-files --cached --others --exclude-standard`, без
`.git`, `node_modules`, `dist`, `.dart_tool`, `build`, Android local properties
и прочего игнорируемого локального состояния. Исходники экспортированы во
временный каталог внутри `/run`, не в legacy repository. Затем выполнены
стандартные восстановления и проверки; проверенные исходники, manifests,
workflow и lock files сверены SHA256 с рабочим деревом после проверок.

Это доказывает восстановление project checks вне исходного абсолютного пути,
но не является реальным `clone` на другом устройстве. SDK и общестанционные
dependency caches оставались теми же. Полностью независимый GitHub runner и
Android build не проверены; они не подменяются этим результатом.

### Локальный CodeReview

Сохранены результаты 10 отдельных `gate --target <directory>`:

- `apps/backend/src`: `codereview-backend.json`;
- `apps/admin/src`: `codereview-admin.json`;
- `apps/mobile/lib`: `codereview-mobile.json`;
- `packages/contracts/src`: `codereview-contracts-ts.json`;
- `packages/contracts/lib`: `codereview-contracts-dart.json`;
- `apps/backend/test`: `codereview-backend-tests.json`;
- `apps/admin/test`: `codereview-admin-tests.json`;
- `apps/mobile/test`: `codereview-mobile-tests.json`;
- `packages/contracts/test`: `codereview-contracts-tests.json`;
- `tests`: `codereview-architecture-tests.json`.

Каждый результат: `PASS`, findings/errors/warnings: 0, без truncation.
Идентичности компонентов сохранены в `codereview-versions.json`.

Ограничение интерпретации: directory gate этой установленной версии запускает
локальные ast-grep/Semgrep rules, но не TypeScript project compiler. Ruff и
BasedPyright пропущены как неприменимые при отсутствии Python. Dart-specific
typechecking / security coverage этим gate не заявляется. Проверка типов TS
выполнена реальным `tsc` в project builds, Dart/Flutter — штатными analyzers.
Нулевые findings CodeReview не объявляются доказательством полной безопасности.

## Android И CI

Команда `mx-build --resolve` из `apps/mobile` завершается кодом 71:

```text
ERROR=NO_SUPPORTED_ANDROID_PROJECT_UNDER_WORKSPACE_REPOSITORIES
```

Read-only диагностика установленного BuildRouter показала два ограничения:
его discovery допускает только direct project или product/project, а для
Flutter требует `PROJECT_ROOT == GIT_TOP`. Структура
`Helpy-Clean/apps/mobile` не удовлетворяет этому station-level контракту.
Дополнительно `sudo -n -v` подтвердил отсутствие текущей non-interactive
authorization. До Android compiler сборка не дошла, APK не создан.

Станция, BuildRouter, GOVERNOR, wrappers, sudoers и системная конфигурация не
изменялись. Отдельный Git repository, commit, symlink или нестандартный build
обход для удовлетворения station discovery не создавались. Ограничения
станции не переносились в архитектурный контракт Helpy.

В репозитории подготовлен штатный CI путь: clean checkout, Node / Flutter /
JDK / Android SDK installation, lock restoration, проверки, реальный
`flutter build apk --debug` и upload с `if-no-files-found: error`.
Но workflow ещё не исполнялся: remote не добавлялся, push запрещён владельцем.
Успешный CI и Android build должны быть предъявлены отдельно после разрешения
принимающей стороны. Ошибки Gradle/Android до такой проверки не исключены.

## Критерии F1

| Критерий из F1_SCOPE | Состояние |
|---|---|
| 1. Независимая структура Mobile/Backend/Admin | Подтверждена в объёме F1 |
| 2. Реальные executable entry points | HTTP / process / headless Flutter smoke PASS; Android runtime не проверен |
| 3. Отдельная граница Shared API Contracts | Типы и общие fixtures PASS |
| 4. Реальные verification commands | 28 тестов, builds и native analyzers PASS |
| 5. Переносимые стандартные commands | Project checks в чистом снимке PASS; Android build остаётся непроверенным |
| 6. Нет legacy implementation в source tree | Новый код и штатный Flutter scaffold; legacy не подключался |
| 7. Определены и проверяются dependency directions | Import regression checks и отрицательные примеры PASS |
| 8. Общая локализация TH/RU/EN | Общий каталог и все шесть переходов обоих UI PASS |
| 9. Другой device / clean clone / независимый CI Android build | НЕ ПОДТВЕРЖДЁН; workflow подготовлен |

## Исправлено При Проверках

- Первоначальная недоступность toolchains через `PATH` разрешена обнаружением
  штатных установок; после чтения station contract использованы launchers.
- Первоначальный Vite 7 блокировался SIGSEGV native `esbuild`. До фиксации
  финального lock выбран актуальный Vite 8.3.8; окончательные `npm ci`, build
  и audit прошли без workaround или подавления install scripts.
- Исправлена JSON-derived exported TypeScript declaration, не компилировавшаяся
  у NodeNext consumer. Финальная публичная declaration не импортирует JSON.
- Относительный Flutter asset заменён стандартным package asset; созданная
  промежуточным вариантом generated copy удалена, остался один source catalog.
- Исправлен тестовый async-zone hang чтения assets; реальные startup/asset IO
  в widget tests выполняются через `tester.runAsync`. UI switching и persistence
  проверяются отдельно, без искусственного ожидания записи внутри fake zone.

## Остаточные Ограничения

- Android APK не собран; CI и другое устройство не квалифицированы.
- Полноценный browser visual / accessibility audit и Android device test не
  выполнялись. Admin DOM tests используют jsdom; HTTP smoke проверяет build
  assets, но не исполняет JS module в настоящем browser renderer.
- Plugin persistence в Mobile проверена с штатным mock SharedPreferences,
  не на физическом Android storage. Состояние и reload mock store проверены.
- Published content, Dynamic Form Engine и перевод переписки здесь отсутствуют;
  их переключение/перевод не выдаётся за уже выполненный тест F1.
- Test commands применяют существующие общестанционные caches; полностью
  пустой SDK/dependency cache воспроизводиться локально не пытались.

## Состояние Перед Передачей

Исходный Git HEAD: `67c83bb`. Commit, amend, push, создание remote и staging
не выполнялись. Legacy repositories и station tool sources не изменялись.
`git diff --check` выполнен без замечаний. Пользовательские изменения не
отменялись; исходное рабочее дерево до реализации было чистым.

Исходники, документация и evidence оставлены для принимающей стороны.
F2 не начат. Работа остановлена до дальнейшего решения владельца.

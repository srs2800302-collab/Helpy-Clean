# F1 — техническая реализация

Статус документа: кандидат на приёмку вместе с реализацией F1.

## Границы

```text
apps/
  mobile/       Flutter executable, shared core, feature data/domain/presentation
  backend/      TypeScript executable, domain/application/infrastructure/transport
  admin/        TypeScript/Vite executable, application/infrastructure/presentation
packages/
  contracts/    TypeScript + pure Dart wire DTO and a single TH/RU/EN catalog
tests/          Executable dependency-direction and portability checks
.github/
  workflows/    Independent clean-checkout verification and Android debug build
```

Все исходники созданы заново. Flutter Android scaffold создан штатным
`flutter create`, не взят из старой реализации. Legacy repositories не читались
и не копировались. Никакие Git ancestry, submodules, subtree или source symlinks
старой реализации не подключались.

## Технические Решения

- Mobile: Flutter, `flutter_bloc`/Cubit, GetIt, `fpdart.Either`, strict analyzer.
- GetIt выбран как DI; Injectable code generation для этой оболочки не нужен.
- Backend: TypeScript strict и стандартный Node HTTP adapter. Worker/D1 относятся
  к F3 и не подключались.
- Admin: самостоятельное приложение TypeScript/Vite 8 без лишнего UI framework.
- Node test runner используется для контрактов, HTTP, Admin DOM и архитектуры.
- Dart Contracts проверяются отдельно через `dart analyze` и `dart test`.
- JSON mapping health DTO находится только в Shared Contracts, не в Entities.
  Это небольшой вручную проверяемый wire DTO без Domain; генерация Freezed /
  JsonSerializable для него в F1 не вводилась.

Выбор зависимостей относится к разрешённым в F1 техническим решениям и не
определяет новые бизнес-правила. Версии восстановления фиксируются lock files.

## Направления Зависимостей

Backend: composition root -> Node adapter -> runtime-neutral HTTP transport.
Будущие бизнес-операции transport вызывает через Application; Application
зависит от Domain и собственных ports, а не от adapter. Domain пока содержит
только описание границы: Entities/UseCases относятся к F2.

Admin: composition root соединяет browser storage adapter, application settings
и presentation. Presentation не импортирует storage adapter.

Mobile: composition root разрешает зависимости через GetIt. Общий Cubit
управляет locale; Widgets только отображают состояние и передают выбор.
Device preference adapter реализует общий port с typed failures. Feature
`data/domain` не заполняются фиктивной бизнес-логикой ради наличия кода.

Contracts не импортируют приложения, UI, SDK, database или business entities.
Domain не импортирует wire DTO. Проверки в `tests/architecture.test.mjs`
проверяют реальные import/export dependencies и содержат отрицательные
примеры запрещённых направлений. Это regression guard, не доказательство
отсутствия любых возможных архитектурных нарушений будущего кода.

## Локализация

Единственный каталог: `packages/contracts/lib/src/catalog.json`.
TypeScript импортирует этот файл, Flutter включает его как стандартный
package asset `packages/helpy_contracts/src/catalog.json`. Ручных копий нет.
Проверки обеих языковых реализаций проверяют полноту языков и ключей.

Mobile использует общий `LanguageCubit`, `flutter_localizations`, device
preferences и локализованные сообщения ошибок. Admin использует общий
application settings controller и browser storage adapter. Оба UI переключают
TH/RU/EN немедленно без перезапуска и независимо сохраняют выбранный язык.
Отсутствующая preference технической оболочки использует EN; повреждённое или
недоступное storage явно диагностируется, а не считается успешной записью.
В Mobile записи сериализованы, чтобы быстрые переключения не сохраняли старое
значение последним.

Каталог содержит только тексты технической оболочки F1. Это не хранилище
изменяемого через Admin бизнес-контента. Published content, Registry, формы и
chats здесь отсутствуют и при своей реализации должны использовать ту же
выбранную locale, а не собственную feature-specific систему локализации.

`backend/src/application/translation-provider.ts` определяет только port
будущего translation adapter. Провайдер, API перевода, credentials, persistence
сообщений и сами chats не реализованы. Original text и перевод не смешиваются:
port принимает original и возвращает отдельную строку-представление. Он не
импортирует provider SDK, HTTP или database. Это точка расширения, не обещание
уже работающего перевода переписки.

## Команды

Первичная подготовка: `npm ci` из корня; `dart pub get --enforce-lockfile`
в `packages/contracts`; `flutter pub get --enforce-lockfile` в `apps/mobile`.

Независимые lifecycle после подготовки shared dependencies:

| Компонент | Build / analyze | Test | Run |
|---|---|---|---|
| Contracts TS | `npm run build -w @helpy/contracts` | `npm test -w @helpy/contracts` | библиотека |
| Backend | `npm run build -w @helpy/backend` | `npm test -w @helpy/backend` | `npm start -w @helpy/backend` |
| Admin | `npm run build -w @helpy/admin` | `npm test -w @helpy/admin` | `npm run dev -w @helpy/admin` |
| Contracts Dart | `dart analyze --fatal-infos` | `dart test` | библиотека |
| Mobile | `flutter analyze --fatal-infos`; `flutter build apk --debug` | `flutter test` | `flutter run` |

Dart/Flutter commands выполняются в соответствующем каталоге. Перед Node
tests требуется build; Admin tests также проверяют HTTP-раздачу build outputs.
`npm run verify` обеспечивает этот порядок для всех Node workspaces.

## CI И Станция

`.github/workflows/verify.yml` содержит два независимых jobs. Node job
восстанавливает зависимости через `npm ci`, компилирует и проверяет проект.
Flutter job устанавливает JDK 17, Android SDK, Flutter 3.47.2, восстанавливает
lock files, проверяет Dart Contracts и Mobile и выполняет Android debug build
с обязательной выгрузкой APK. Станционные caches, абсолютные пути, secrets,
BuildRouter и локальный CodeReview ему не нужны.

На MX-станции используются принятые launchers и CodeReview CLI. Вызовы этих
инструментов являются локальным способом проверки, а не частью project
runtime/build contract. BuildRouter, GOVERNOR, системные wrappers и конфигурация
станции в рамках F1 не изменяются. Их ограничения не обходятся.

Android wrapper scripts и jar восстанавливаются штатным Flutter tooling;
`local.properties` генерируется по текущему окружению и не входит в Git.
Release signing не подменён debug signing. Production build/deployment вне F1.

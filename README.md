# Helpy

Новая независимая реализация Helpy.

## Статус

Этап 1, пакет F1 — реализация подготовлена; проверки и приёмка ещё не закрыты.

F1 — `IMPLEMENTED / ACCEPTANCE PENDING`.

Реализованы только технические основы F1. Android build и выполнение CI ещё
не подтверждены. Переход к F2 не выполнялся.

## Документы

- `docs/00_DEVELOPMENT_PLAN.md` — порядок разработки;
- `docs/01_ARCHITECTURE_PRINCIPLES.md` — архитектурные инварианты;
- `docs/02_REFERENCE_POLICY.md` — правила использования старой реализации;
- `docs/03_REQUIREMENTS_AUTHORITY.md` — иерархия источников требований;
- `docs/foundation/F1_SCOPE.md` — границы F1.
- `docs/foundation/F1_IMPLEMENTATION.md` — структура, решения и команды F1;
- `docs/foundation/F1_REPORT.md` — технический отчёт и ограничения проверки.

## Инструменты

- Git;
- Node.js `24.22.2`, npm `11.19.1`;
- Flutter `3.47.2` stable, Dart `3.13.2`;
- JDK 17 и Android SDK для Android build.

Пути установки инструментов определяются окружением, а не репозиторием.
Станционные launchers и CodeReview не являются зависимостями CI Helpy.

## Восстановление И Проверки

Из корня репозитория:

```sh
npm ci
npm run verify
```

В `packages/contracts`:

```sh
dart pub get --enforce-lockfile
dart format --output=none --set-exit-if-changed lib test
dart analyze --fatal-infos
dart test
```

В `apps/mobile`:

```sh
flutter pub get --enforce-lockfile
dart format --output=none --set-exit-if-changed lib test
flutter analyze --fatal-infos
flutter test
flutter build apk --debug
```

Все lock files входят в состав проекта. GitHub Actions самостоятельно
устанавливает toolchains, выполняет проверки и Android debug build.
Факт успешного запуска CI до публикации не заявляется.

## Независимый Запуск

После `npm ci` и `npm run build`:

```sh
npm start --workspace @helpy/backend
npm run dev --workspace @helpy/admin
```

Backend: `http://127.0.0.1:3000/health`. Runtime-параметры: `HOST`, `PORT`.
Admin: адрес выводится Vite при запуске. Это техническая оболочка без
продуктовых административных функций, не защищённая production-панель.
Ни один из этих компонентов не требует запуска другого.

Mobile запускается командой `flutter run` из `apps/mobile` на настроенном
Flutter-устройстве. Язык интерфейса выбирается в Mobile и Admin независимо.

APK является debug-артефактом, production signing и deployment не настроены.

## Рабочий цикл

`диагностика → реализация → независимые проверки → доказательный отчёт → приёмка владельцем`

Без явной приёмки владельца этап или пакет не считается завершённым.

# Helpy — архитектурные принципы

## 1. Clean Rebuild

Legacy implementation не определяет архитектуру новой системы.

Новый код создаётся заново.

## 2. Архитектурные слои

Обязательные границы:

- Domain;
- Application;
- Infrastructure;
- Transport;
- Presentation.

Domain не зависит от внешних слоёв.

## 3. Flutter

Каждый feature:

- `data`;
- `domain`;
- `presentation`.

Presentation использует только Bloc/Cubit.

Widgets не содержат business logic.

Domain Entities не содержат JSON mapping, Flutter или Infrastructure dependencies.

Data содержит Repository implementations, DataSources и DTO.

DTO mapping выполняется через Freezed / JsonSerializable там, где это применимо.

Ожидаемые ошибки возвращаются типизированно через `Either`.

Конкретный выбор `fpdart` или `dartz` фиксируется в F1.

## 4. Dependency Injection

Flutter использует GetIt / Injectable.

## 5. Backend

Business logic не зависит от:

- Cloudflare Worker runtime;

- D1;

- HTTP transport;

- Конкретного server provider;

- Конкретного database provider.

Cloudflare Worker и D1 являются первоначальными Infrastructure adapters, а не архитектурной основой Helpy.

Domain и Application работают только через собственные interfaces/contracts и не импортируют provider-specific SDK или API.

Server, database и transport adapters должны быть заменяемыми без изменения Domain и бизнес-правил.

Переезд на другой server runtime, database или transport не должен требовать переработки бизнес-логики. Изменения допускаются только в соответствующих Infrastructure/Transport adapters, configuration и deployment layer.

## 6. Admin

Admin является самостоятельным приложением управления предусмотренной конфигурацией и контентом Helpy.

## 7. Shared API Contracts

API contracts типизированы и отделены от Domain Entities.

Contracts проверяются тестами.

## 8. Динамические бизнес-значения

Значения, изменяемые через Admin, не хранятся как неизменяемый hardcode в executable code.

## 9. Переносимость

Проект не зависит от:

- абсолютных путей рабочей станции;
- станционных launcher/build tools;
- локальных пользователей;
- локальных caches;
- локальных secrets.

Проект имеет собственные стандартные build/test/verification commands.

## 10. Replaceable Infrastructure

Server, database и внешние providers подключаются через заменяемые adapters.

Их замена не должна требовать изменения Domain.

## 11. Качество

Обязательны:

- SOLID;
- DRY;
- KISS;
- YAGNI;
- strict typing;
- Null Safety;
- явная обработка ошибок;
- реальные детерминированные тесты.

Успешный `exit code` без фактической проверки не является PASS.

## 12. Мультиязычность

Мультиязычность является сквозным архитектурным инвариантом.

Mobile UI и Admin UI поддерживают TH / RU / EN.

Выбранный пользователем язык хранится отдельно от бизнес-данных и может быть изменён без перезапуска или пересборки.

Переключение между любыми двумя языками из TH / RU / EN в обоих направлениях должно немедленно переотображать на выбранном языке:

- UI;
- системные тексты;
- динамический контент;
- Registry;
- Dynamic Form Engine;
- временный pre-selection chat;
- постоянный рабочий chat;
- уже загруженные сообщения переписки.

Оригинальный текст пользовательского сообщения сохраняется неизменным.

Перевод является отдельным представлением оригинала на выбранном пользователем языке.

Mobile, Admin, формы и оба типа chat используют общий механизм локализации и перевода без feature-specific localization logic.

Admin также обеспечивает создание, редактирование и публикацию предусмотренного пользовательского контента на TH / RU / EN.

## Translation provider и secrets

Механизм перевода не зависит от конкретного translation provider.

Конкретный translation provider подключается через заменяемый Infrastructure adapter.

Domain и Application не импортируют provider-specific SDK или API и не зависят от формата конкретного сервиса перевода.

Замена translation provider не должна требовать изменения бизнес-логики, Domain или пользовательских features.

Конкретный translation provider выбирается отдельно на этапе его фактического подключения с учётом качества TH / RU / EN, стоимости, latency, privacy, ограничений API и отказоустойчивости.

API keys, access tokens и другие secrets:

- не хранятся в source code;
- не хранятся в Git;
- не записываются в документацию проекта;
- передаются через защищённую runtime/deployment configuration.

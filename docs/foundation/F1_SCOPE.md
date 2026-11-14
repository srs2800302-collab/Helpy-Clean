# F1 — Clean Structure

Статус: `IMPLEMENTED / ACCEPTANCE PENDING`.

Реализация и результаты проверок описаны в `F1_IMPLEMENTATION.md` и
`F1_REPORT.md`. Android build и CI ещё не подтверждены. Этот статус не
является приёмкой F1 владельцем и не разрешает переход к F2.

F1 — первый технический пакет Этапа 1.

## Входит в F1

Создание независимых основ:

- Mobile;
- Backend;
- Admin;
- Shared API Contracts.

Работа:

- диагностика необходимых инструментов проекта;
- определение архитектурных границ;
- новая структура проекта;
- build tooling;
- dependencies;
- CI;
- минимальные реальные executable entry points;
- реальные проверки;
- изоляция от legacy implementation.

Точная файловая структура и конкретные Backend/Admin technologies определяются после диагностики F1.

Они не наследуются из старой реализации автоматически.

## Mobile

Обязательны:

- Flutter;
- Clean Architecture;
- `data / domain / presentation`;
- Bloc/Cubit;
- Dependency Injection;
- Null Safety;
- strict typing;
- отсутствие business logic в Widgets.


Архитектурная основа Mobile также должна обеспечивать:

- общую архитектурную основу локализации TH / RU / EN;
- хранение выбранного пользователем языка вне business logic;
- немедленное переотображение UI при смене языка;
- отсутствие feature-specific localization logic.

Перевод пользовательской переписки подключается к этой общей архитектурной основе на соответствующих продуктовых этапах.

## Backend

Обязательные границы:

- Domain;
- Application;
- Infrastructure;
- Transport.

Business logic не зависит от server runtime или database.

## Admin

Самостоятельное приложение с собственной executable entry point и build/test lifecycle.

Продуктовая административная функциональность в F1 не входит.


F1 закладывает архитектурную основу локализации Admin UI на TH / RU / EN.

Эта основа должна позволять:

- пользователю Admin самостоятельно выбирать язык интерфейса;
- переключать язык без перезапуска и пересборки;
- использовать общий механизм локализации;
- на последующих этапах управлять локализованным пользовательским контентом TH / RU / EN.

Полноценная продуктовая административная функциональность в F1 не реализуется.

## Shared API Contracts

Отдельная типизированная граница контрактов между компонентами.

Contracts не заменяют Domain Entities и проверяются тестами.

## F1 завершён только когда

1. Mobile, Backend и Admin имеют корректную независимую структуру.
2. Каждый компонент имеет минимальную реальную executable entry point.
3. Shared API Contracts имеют определённую границу ответственности.
4. Verification commands выполняют реальные проверки.
5. Стандартные build/test commands не зависят от конкретной рабочей станции.
6. Legacy implementation отсутствует в новом source tree.
7. Dependency directions определены и проверяемы.

Полное взаимодействие компонентов принимается на F5 и приёмке Этапа 1.


Дополнительный обязательный критерий F1:

8. Mobile и Admin используют общую архитектурную основу локализации TH / RU / EN, пригодную для дальнейшего подключения Dynamic Form Engine, локализованного контента и обоих типов chat.


### Translation boundary

Translation provider в F1 не фиксируется.

F1 должен сохранить архитектурную возможность подключения и замены translation provider через Infrastructure adapter без изменения Domain, Application и feature logic.

Provider credentials и другие secrets не входят в source code, Git или документацию и должны поступать через runtime/deployment configuration.

### Переносимость разработки и CI

F1 должен создать переносимый project lifecycle, не зависящий от локальной среды, в которой велась разработка.

Обязательно:

- стандартные project-level команды и конфигурация для восстановления зависимостей, проверок и сборки;
- dependency manifests и lock files хранятся в Git;
- GitHub Actions workflow запускается из чистого checkout;
- CI самостоятельно устанавливает заявленные toolchains и зависимости;
- CI выполняет обязательные проверки проекта;
- CI выполняет Android build;
- CI не требует локальной конфигурации предыдущего устройства разработки;
- локальные абсолютные пути, SDK layout, caches, wrappers и runtime state не входят в обязательные зависимости проекта.

Обязательный критерий приёмки F1:

9. После чистого clone на другом устройстве разработчик может продолжить цикл `change → commit → push`, а GitHub Actions независимо подтверждает проверки и Android build без переноса локальной конфигурации исходной среды разработки.

## Не входит в F1

- authentication flows;
- профили;
- Registry functionality;
- Dynamic Form Engine;
- заказы;
- offers;
- negotiation;
- Final Agreed Price;
- payment flows;
- chats;
- reviews;
- disputes;
- production deployment;
- production database access.

## Приёмка

`диагностика → реализация → независимые проверки → доказательный отчёт → приёмка владельцем`

Наличие каталогов и файлов не является доказательством готовности F1.

# Архитектура Antidetect v2

> Статус: принятая целевая архитектура; реализация и поведение внешнего runtime ещё не подтверждены<br>
> Последняя ревизия: 2026-09-19<br>
> Авторитетен для: границ компонентов, lifecycle и обязательных инвариантов<br>
> Текущее состояние: [current-state.md](current-state.md)
> Открытые вопросы: [risk-and-decision-log.md](risk-and-decision-log.md)

## Как читать утверждения

- **Принятая цель** — согласованное решение, которое может ещё не быть реализовано.
- **Требует проверки** — гипотеза о ShardX, Windows, dependency или runtime behavior.
- **Открытое решение** — выбор ещё не сделан; указан ID из decision log.
- **Фактическое состояние** — допустимо только со ссылкой на актуальный аудит или проверку.

Этот документ не доказывает, что target уже реализован.

## Граница системы

**Принятая цель:** Antidetect v2 — local-first control plane поверх стороннего ShardX runtime.

ShardX должен отвечать за:

- patched Chromium;
- fingerprint identity и device profiles;
- persistent `userDataDir`;
- низкоуровневый launch/stop;
- proxy/runtime capabilities;
- PID, process handle и CDP metadata в объёме, который подтвердит SDK audit.

Приложение отвечает за:

- profile и proxy metadata;
- lifecycle state machine;
- concurrency и database invariants;
- process registry;
- crash recovery и reconciliation;
- typed errors и events;
- secret handling и redaction;
- API, SSE, UI, diagnostics и tests.

ShardX types не выходят за infrastructure adapter. Domain/application code зависит от нашего `BrowserRuntime`, а не от SDK-specific objects.

## Production model

**Принятая цель:** один локальный Node.js process.

```text
Browser UI
    |
same-origin HTTP/SSE
    |
Fastify HTTP server (`FastifyAdapter`)
    |
NestJS application modules/controllers
    |-- application/domain services and ports
    |-- SQLite
    |-- in-memory process registry
    |-- filesystem
    `-- ShardXRuntime -> ShardX SDK -> Chromium process tree
```

- Windows x64 first.
- NestJS управляет API modules, controllers и dependency injection — внедрением зависимостей; Fastify остаётся HTTP provider — HTTP-движком — через `FastifyAdapter`.
- Fastify слушает только loopback и раздаёт собранный React SPA с того же origin.
- Domain/application code не импортирует NestJS decorators или Fastify-specific types; framework используется на API и composition boundary — границе сборки зависимостей.
- SQLite и application data хранятся локально.
- Одним каноническим корнем `ANTIDETECT_HOME` управляет только один экземпляр API. Базовый механизм межпроцессного владения корнем и порядок bounded shutdown выбраны по D-015/ADR-0010 до записи продуктовых данных; блокировка в памяти одного процесса не защищает от второго экземпляра.
- Docker, Redis, queues, workers, microservices и desktop shell не входят в MVP.

## Целевой стек

Базовый набор технологий принят; фактические версии берутся из manifests — описаний пакетов — и lockfile — файла точных зависимостей. Локальный gate Phase 2 на Node.js `24.18.0` и pnpm `11.16.0` подтвердил frozen install, format, lint, typecheck, 131 Vitest-тест, production build, startup integration 4/4 и общий/production dependency audit. `fastify: 5.12.1` закреплён в pnpm workspace override; policy окончания строк зафиксирована в `.gitattributes`. Ветка опубликована до текущего незакоммиченного снимка; конфигурация CI — автоматических проверок — включает Ubuntu, Windows и тесты запуска API, но удалённые результаты текущего кода не подтверждены.

| Область               | Принятая цель                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Runtime               | Node.js 24 LTS, ESM                                                                                                           |
| Language              | TypeScript 6.0.x                                                                                                              |
| Workspace             | pnpm 11 workspaces без Nx/Turborepo                                                                                           |
| Application framework | NestJS, feature modules и providers — зарегистрированные зависимости                                                          |
| HTTP provider         | Fastify 5 через `@nestjs/platform-fastify` и `FastifyAdapter`                                                                 |
| API contracts         | Zod 4 как источник истины; `nestjs-zod` подключает validation/serialization — проверку входа и ответа — без дублирования схем |
| API docs              | OpenAPI через `@nestjs/swagger` и `nestjs-zod`; JSON-документ доступен на `/docs-json`, финальные routes остаются в `D-010`   |
| Logging               | структурированные Pino-логи с обязательным redaction; конкретная NestJS-интеграция проверяется до добавления operational logs |
| Events                | native SSE                                                                                                                    |
| Persistence           | SQLite, `better-sqlite3`, Kysely, explicit SQL migrations                                                                     |
| Frontend              | React 19, Vite 8, React Router, TanStack Query                                                                                |
| Forms/UI              | React Hook Form, Zod, Tailwind CSS, shadcn/ui                                                                                 |
| Tests                 | Vitest, `@nestjs/testing`, Fastify `inject()`, Playwright UI tests                                                            |

Точная версия ShardX pin принимается только после Phase 0 dependency/API audit. Автоматическое обновление запрещено.

В текущем `apps/web` используются React/Vite и обычный CSS. Остальные клиентские библиотеки в таблице — целевой набор, а не установленные зависимости. Их добавление и возможный перенос стилей согласуются перед конкретной функцией; переписывание работающего макета не является условием начала API-интеграции.

## Границы репозитория

Чистая публичная V2-разработка ведётся в orphan-ветке — ветке без legacy-истории — `v2/public-foundation`, Git worktree — независимой рабочей папке — `C:\Disk_D\GitRepo\antidetect-v2-public`; все пути в схеме ниже заданы относительно её корня. Корневые `apps/` и `packages/` прежней рабочей папки остаются legacy/prototype и не становятся частью v2.

**Принятая цель:** компактный modular monolith.

```text
apps/
  api/
    src/
      app.module.ts
      modules/
        profiles/
        proxies/
        browser-lifecycle/
        engine/
        events/
      infrastructure/
        database/
        shardx/
        processes/
        filesystem/
      app/
      config/
  web/

packages/
  contracts/
```

Это ориентир, а не требование создавать пустые слои. Абстракция появляется только при реальной boundary или необходимости тестовой подмены.

`packages/contracts` содержит только boundary types:

Для API Zod-схема является source of truth (источником истины), а TypeScript-типы выводятся из неё через `z.infer`. NestJS controllers получают схемы через `nestjs-zod`; `createZodDto` создаёт только framework-адаптер для метаданных, не вторую схему. Самостоятельные дублирующие DTO или `class-validator`-описания для тех же payload не создаются.

- Zod request/response schemas;
- DTO, выведенные из schemas;
- SSE event schemas;
- public error codes;
- общие enums/value types.

Database entities, ShardX types, NestJS controllers/providers и application services туда не помещаются.

Направление зависимостей исходного кода:

```text
HTTP controllers -> application services -> domain rules/ports
infrastructure adapters -----------------> domain rules/ports
UI -> API contracts
```

Controllers выполняют validation, access/policy checks и mapping. Lifecycle logic в controllers запрещена. NestJS providers связывают application ports с реализациями, но не заменяют сами domain rules.

При выполнении сервис вызывает адаптер через свой интерфейс, но не импортирует конкретную реализацию. UI — пользовательский интерфейс — обращается к серверу по HTTP, а не импортирует серверные сервисы.

## Runtime boundary

**Принятая цель:** application-owned interface с двумя реализациями.

```ts
interface BrowserRuntime {
  launch(input: RuntimeLaunchInput): Promise<RuntimeProcess>;
  stop(process: RuntimeProcess, options: StopOptions): Promise<StopResult>;
}
```

Interface выше концептуальный и уточняется после spike.

- `ShardXRuntime` — единственный пользовательский runtime v2.
- `FakeBrowserRuntime` — обязательный deterministic test runtime.
- Bablosoft — legacy/backlog.
- Обычный Chromium — только test baseline, не antidetect feature.

Приложение не строится вокруг SDK session abstraction: lifecycle, registry, transitions и recovery остаются под нашим контролем.

## Источники истины

| Источник                                       | Отвечает за                                              | Не доказывает сам по себе            |
| ---------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| SQLite                                         | Business metadata, durable invariants, run/event history | Что process жив                      |
| `%LOCALAPPDATA%\\Antidetect\\profiles\\<uuid>` | Frozen identity и Chromium data                          | Lifecycle status                     |
| In-memory registry                             | Живые handles, listeners и runtime control               | Состояние после crash API            |
| OS                                             | Существование process и проверяемую identity             | Принадлежность по одному PID         |
| ShardX SDK                                     | Launch/stop и low-level metadata                         | Наши concurrency/recovery guarantees |

## Политика каталогов

**Принятое решение D-009 для Windows x64:** приложение использует единый корень `ANTIDETECT_HOME`. По умолчанию это `%LOCALAPPDATA%\\Antidetect`, а для разработки можно переопределить его на `./data`; тесты используют отдельный временный каталог.

Внутри корня находятся:

- `config/` — настройки приложения без proxy credentials;
- `data/antidetect.sqlite` — SQLite-метаданные profiles, runs и events;
- `profiles/<server-generated-uuid>/` — данные Chromium конкретного profile;
- `runtime/` — engine binaries и runtime cache, не часть Git;
- `logs/` — операционные логи с обязательной redaction.

`.gitignore` исключает локальные `data/`, `profiles/`, `runtime/` и SQLite-файлы, но ignore-правило не является границей безопасности. Хранение proxy credentials остаётся отдельным открытым решением D-003. Чистый resolver путей, разделённая подготовка каталогов и базовый root guard реализованы в `apps/api`; проверка Windows ACL и production-политика прав остаются отдельным следующим слоем.

### Startup boundary

`apps/api/src/main.ts` — composition root — место связывания конфигурации и инфраструктуры. Текущий реализованный порядок: проверка `API_HOST` и `API_PORT`, `resolveAppPaths()`, создание только `rootDir` и `dataDir`, `acquireRootOwnership()` на `data/antidetect.sqlite`, создание Kysely над тем же SQLite-соединением и проверка `select 1`, проверка совместимости и применение миграций, барьер восстановления, затем создание остальных каталогов, `buildApp()` и `app.listen()`. Поэтому второй процесс с тем же корнем не доходит до Kysely-проверки, продуктовых каталогов и HTTP-порта.

Реальный smoke test с временным `ANTIDETECT_HOME` подтвердил создание пяти каталогов и ответ `/health` со статусом `200`. Если корень является файлом, процесс завершается с `ENOTDIR` без fallback — запасного небезопасного пути — и без открытия порта. Это покрывает только startup/filesystem boundary; межпроцессные гонки, ACL, SQLite и recovery остаются отдельными слоями.

Ни поле `running`, ни PID, ни in-memory handle не являются единственным источником истины.

По [ADR-0010](adr/0010-sqlite-exclusive-root-ownership.md) базовый порядок владения корнем реализован. После вычисления путей процесс создаёт только корень и `data`, открывает основное SQLite-соединение, включает `locking_mode=EXCLUSIVE` и короткой проверкой фактически захватывает блокировку. Только владелец создаёт остальные каталоги, а затем вызывает `buildApp()` и `app.listen()`. Проигравший процесс получает `APP_ROOT_IN_USE` и завершается без продуктовых записей и порта.

Основное SQLite-соединение остаётся открытым до конца работы API и закрывается последним ресурсом корня; длительная транзакция для этого не используется. `createAppDatabase()` передаёт Kysely тот же native handle, которым владеет root ownership, поэтому второй SQLite-клиент внутри приложения не создаётся. `verifyAppDatabase()` с `select 1` проверяет доступность соединения, а `runMigrations()` применяет явные SQL-миграции до открытия HTTP-порта. До применения новых миграций проверяется вся история: неизвестная версия, несовпадение имени или пропущенная предыдущая миграция вызывают `INCOMPATIBLE_DATABASE_SCHEMA`. Изменения схемы и запись об одной миграции выполняются атомарно; это проверено обновлением предыдущей версии и искусственным отказом записи истории. Сейчас подключены миграции `schema_migrations`/`profiles`/`profile_code_sequence`/`browser_runs`; `ProfileRepository` и `BrowserRunRepository` остаются application ports — портами прикладного слоя, — а SQLite-адаптеры реализуют их в infrastructure — инфраструктурном слое. Репозиторий профилей отдельно выдаёт постоянный `profileCode` через SQLite-последовательность и не смешивает его с техническим UUID `id`. `BrowserRunService` принимает решения о создании и переходах, а репозитории только читают и сохраняют данные. Это не заменяет recovery и не означает, что профиль готов к запуску браузера. При штатном завершении `ApiRuntime` сначала закрывает HTTP-приложение, затем root ownership; повторный `close()` безопасен. Если `app.close()` завершается ошибкой или превышает bounded timeout — ограниченное время ожидания, — root ownership не освобождается: это fail-closed — безопасный отказ с сохранением блокировки, — чтобы второй API не занял корень, пока первый процесс ещё жив. После истечения таймаута процесс завершается с ошибкой, а ОС освобождает файловую блокировку; новый владелец всё равно обязан выполнить recovery до готовности API. Владение корнем не освобождает сохраняемую занятость профилей по ADR-0009. Выполнены unit-, межпроцессные и локальные black-box проверки двух API; profile recovery, платформенное поведение сигналов и Linux CI остаются открытой частью D-015.

При завершении API новые команды сначала прекращают приниматься; правило для живых браузеров и сроки завершения выбираются до реализации управления процессами. Строгая проверка `API_PORT`, запрет внешнего `API_HOST`, базовая request policy и memory-only session boundary уже реализованы; process-aware recovery и более сильная local authentication остаются открытой частью D-002/D-015 до расширения чувствительных HTTP-методов.

## Domain records

### `profiles`

- server-generated UUID и стабильный `profileCode`;
- display name и notes;
- immutable ShardX identity/template reference;
- runtime/filesystem metadata;
- optional proxy reference;
- timestamps.

Имя не участвует в filesystem path. Rename не перемещает directory. Смена fingerprint означает новую identity/clone, а не мутацию текущей.

Отдельный ненадёжный `profile.status` не хранится, если состояние можно вывести из записи занятости, запуска и проверенного состояния процессов. Запись занятости не равна утверждению, что браузер сейчас работает: она также запрещает опасные операции при неопределённом состоянии.

Публичный ответ Phase 2 по ADR-0013 содержит только `id`, `profileCode`, `displayName`, тестовый `identityRef`, `createdAt` и `updatedAt`; notes, proxy/runtime metadata и отдельный `status` в этот контракт не входят. UUID `id` остаётся техническим ключом API и файловой системы, а `profileCode` предназначен для UI и поддержки.

### `proxies`

- UUID;
- protocol, host, port;
- username и признак auth;
- secret reference или выбранное защищённое representation;
- redacted check result;
- timestamps.

Способ хранения credentials определяется решением `D-003`.

### `browser_runs`

Каждая попытка запуска создаёт новую запись:

- run UUID и profile UUID;
- mode;
- lifecycle status;
- проверяемая process identity;
- минимально необходимая CDP metadata;
- timestamps и exit information;
- typed failure code;
- redacted diagnostic context.

Terminal run не переиспользуется.

### `events`

Ограниченная диагностическая история:

- event ID;
- profile/run references;
- type;
- redacted payload;
- timestamp.

Retention и replay semantics определяются в `D-007`.

## Lifecycle state machine

Машина состояний описывает жизненный цикл запуска. По [ADR-0009](adr/0009-durable-profile-occupancy.md) конечное состояние означает, что принадлежащие запуску процессы завершены либо не были созданы. Потеря управления не является доказательством завершения.

Базовые переходы после подтверждения соответствующего результата:

- `starting -> running | failed`;
- `running -> stopping | stopped | failed`;
- `stopping -> stopped | failed`.

`stopped` — штатное конечное состояние, включая подтверждённое закрытие браузера пользователем. `failed` — нештатное конечное состояние после подтверждённого завершения процессов или отказа до их создания.

При потере управления, неоднозначной идентичности процесса или неудачной очистке занятость сохраняется в `browser_runs` и восстанавливается после перезапуска API. `recovery_required` остаётся блокирующим состоянием до проверки process identity и завершения принадлежащего дерева. `BrowserRunService` применяет transition guard и `ProfileOperationMutex` до записи в repository; `BrowserRunRecoveryBarrier` выполняет read-only проверку всех блокирующих runs и не меняет их статусы. На startup barrier вызывается после миграций и до `ensurePostOwnershipDirectories`, `buildApp` и `listen`; при `blocked` процесс завершается, а root ownership освобождается без открытия порта. Process-aware recovery и обработка Stop во время `starting` уточняются по D-004/D-014 до реализации команд.

Переходы задаются централизованно. Текущий `BrowserRunService.transition()` проверяет только допустимость перехода записи, а не состояние процесса; его нельзя напрямую публиковать как HTTP-команду. Подтверждение завершения или отказа до создания процесса добавляется в Phase 3 с `FakeBrowserRuntime`, тестовой заменой движка. Повторный переход в `stopped` не доказывает идемпотентность настоящей остановки.

Ошибка барьера восстановления содержит только разрешённые диагностические поля `id`, `profileId`, `status`; исходная запись с `processIdentity` и `failureCode` не прикладывается к исключению. Это не заменяет проверку очистки данных будущего адаптера ShardX.

## Lifecycle invariants

1. У профиля не более одного запуска, удерживающего занятость: обычные активные состояния и неразрешённая потеря управления одинаково запрещают новый запуск.
2. Правило обеспечивается ограничением SQLite, переживающим перезапуск API. `browser_runs_one_active_per_profile` учитывает `starting`, `running`, `stopping` и `recovery_required`; `stopped` и `failed` остаются историей и не занимают индекс. Точный выбор зафиксирован в [ADR-0012](adr/0012-browser-run-occupancy.md).

3. `ProfileOperationMutex` сериализует операции одного profile, но не заменяет database constraint; операции разных profiles не блокируются глобально.
4. Операции разных profiles не блокируются глобально.
5. Каждая launch attempt создаёт новый run.
6. Повторный `stop` безопасен и идемпотентен.
7. Занятый профиль нельзя удалить; переименование не меняет каталог. Правила изменения прокси и других параметров запуска, а также их согласование с конкурентным Start определяются по D-014 до соответствующих операций записи.
8. Fingerprint identity immutable.
9. Filesystem path строится только из server-generated UUID.
10. Process принадлежит run только после проверки identity; одного PID недостаточно.
11. Foreign Chromium нельзя завершать или принимать за наш.
12. Частичный запуск заканчивается подтверждённой очисткой либо сохраняемой занятостью и обнаруживаемым потерянным процессом. Ошибка SDK или возврат из Stop сами по себе занятость не снимают.
13. Secrets не входят в run metadata, events или diagnostics.

## Start flow

**Принятая цель:**

1. Проверить формат запроса; состояние профиля и параметры повторно читать под блокировкой.
2. Получить блокировку операций этого профиля и проверить его существование, состояние движка и политику прокси.
3. Под блокировкой операций профиля проверить отсутствие активной занятости и создать `starting`; partial unique index `browser_runs_one_active_per_profile` атомарно защищает профиль от второго активного run, включая гонку другого процесса.
4. Подготовить runtime input и UUID-based directory.
5. Запустить runtime.
6. Зарегистрировать handle и exit listener.
7. Сохранить process identity и перевести run в `running`.
8. Опубликовать redacted domain/SSE event.
9. При ошибке подтвердить отсутствие созданных процессов перед `failed`. Если очистка не подтверждена, сохранить занятость, безопасную диагностику и данные для восстановления; не разрешать повторный запуск или удаление.
10. Release lock.

Conflict/idempotency и sync/async HTTP semantics определяются в `D-004`. Crash window между spawn и сохранением identity закрывается решением `D-006`.

## Stop flow

**Принятая цель:**

1. Acquire per-profile lock.
2. Найти запись занятости, включая неразрешённую потерю управления, и проверить принадлежность и состояние реальных процессов.
3. Если process отсутствует, идемпотентно reconciliate stale state.
4. Перевести run в `stopping`.
5. Запросить graceful stop.
6. Дождаться exit с bounded timeout.
7. При необходимости применить hard kill только к проверенному process tree.
8. Проверить отсутствие process.
9. Перевести запуск в `stopped` либо `failed` только после подтверждения отсутствия принадлежащего ему дерева. При неопределённом результате сохранить занятость и вернуть соответствующий результат команды.
10. Записать redacted event и release lock.

## Reconciliation

**Требования приняты, точная policy требует проверки.**

При старте API должны обрабатываться все записи занятости, включая `starting`, `running`, `stopping` и неразрешённую потерю управления по D-014. `BrowserRunRecoveryBarrier` перечисляет такие записи и блокирует готовность (`blocked`); при пустом наборе возвращает `ready`. Startup применяет этот результат до открытия порта, но barrier не проверяет OS process, не меняет `recovery_required` и не закрывает PID:

- проверяется OS process и его identity;
- stale database state исправляется;
- lost handle не считается автоматически восстановимым;
- application-owned orphan обнаруживается по доказуемому marker;
- PID reuse не приводит к захвату или kill чужого process;
- результат фиксируется typed transition/event.

Безопасное правило сохранять занятость принято в ADR-0009. Конкретный способ восстановить управление, завершить либо изолировать живой процесс определяется по D-001/D-006 и проверяется отдельно на Windows. Startup-интеграция read-only barrier уже закрывает только gate готовности; process-aware recovery policy и модель с подменным движком нужны в Phase 3, а Phase 5 проверяет реальное восстановление, а не впервые выбирает его базовые правила. Закрытый Phase 0 не возобновляется автоматически.

## Runtime modes и CDP

Публичные режимы: `interactive` и `automation`.

Их реальное техническое различие и access policy CDP зависят от SDK behavior (`D-005`). CDP endpoint не возвращается обычным profile API и не публикуется через SSE или logs.

## API и события

**Принятая цель:**

- REST для profiles, proxies, engine state и runs;
- отдельные start/stop commands;
- Zod validation на boundary;
- единый error envelope и stable machine-readable codes;
- request/correlation ID;
- health/readiness;
- native SSE для server-to-UI events.

SSE не является source of truth, использует typed events, event IDs, heartbeat, bounded buffers и освобождает listeners при disconnect. После потери событий UI восстанавливается через GET.

Первый профильный контракт принят в [ADR-0013](adr/0013-profile-http-contract.md): строгий `POST /profiles`, `GET /profiles/:profileId` и ограниченный `GET /profiles` с порядком `createdAt ASC, id ASC`, envelope `{ items, nextOffset }` и ошибками `{ error: { code, message } }`. Клиент задаёт только имя, UUID/timestamps/test identity и стабильный `profileCode` создаёт сервер; отдельного `profile.status` в ответе нет. Zod-схемы, NestJS routes и OpenAPI-интеграция уже подключены и проверены black-box тестами. Web client получает список и создаёт профиль через Vite proxy, валидирует общий контракт, явно показывает loading/error/empty/submitting states и после `POST` повторяет `GET`; отсутствующие status/proxy/identity поля отображаются нейтральными UI placeholders, а `Unknown` не является доменным статусом и не заменяет будущий lifecycle-контракт. Остальные routes, status codes и replay semantics продолжают определяться в `D-004`, `D-007`, `D-010`.

Контракты принимаются по работающему сценарию: создание/чтение профиля в Phase 2, команды и чтение состояния с тестовым движком в Phase 3, поток событий и оставшиеся возможности в Phase 6. До первого списка задаются ограничения размера, порядок и правила выборки. До подключения UI задаются состояния загрузки, пустого списка, ошибки и занятости, а также доступные действия; неизвестное состояние браузера нельзя показывать как безопасно остановленное. Число прокси означает число записей прокси, а не число профилей с назначенным прокси.

## Security invariants

1. API слушает только `127.0.0.1`/`::1`.
2. UI и API используют один origin; wildcard CORS запрещён.
3. API принимает только literal loopback `API_HOST` (`127.0.0.1` или `::1`); каждый запрос обязан иметь ровно один `Host`, совпадающий с configured host/port, а присутствующий `Origin` — точно совпадать с локальным `http://` origin. По ADR-0013/0014 этого достаточно только для ограниченных create/read/list-операций с несекретными profile metadata; базовая session cookie защищает браузерную границу, но риск вызова произвольным локальным процессом через публичный `/session` принят для этого среза. Более сильная local authentication и CSRF/custom-header policy остаются hard gate до proxy credentials, удаления и browser-control API.
4. Profile IDs генерируются сервером.
5. Пользовательский ввод не формирует filesystem paths.
6. Все JSON, filesystem и SDK inputs валидируются на boundary.
7. Proxy password не возвращается обычным API.
8. Secrets отсутствуют в logs, errors, SSE, OpenAPI examples и snapshots.
9. Pino redaction покрывает nested fields и credential-bearing URLs.
10. Полный process argv не логируется и не возвращается.
11. При configured proxy launch работает fail-closed.
12. Engine install/update выполняется только контролируемо.
13. Diagnostics export проходит отдельную redaction.
14. CDP metadata выдаётся только по явно принятой access policy.

Открытые security decisions: более сильная local authentication и CSRF policy для чувствительного localhost access (`D-002`), credentials at rest (`D-003`), CDP exposure (`D-005`), engine integrity (`D-008`). Базовая browser session boundary принята и реализована в ADR-0014.

Известный residual risk: ShardX может передавать proxy credentials через process command line. До проверки и возможного local proxy bridge нельзя заявлять полную защиту от локального пользователя, читающего argv.

## Persistence

**Принятая baseline, compatibility требует проверки:**

- SQLite;
- `better-sqlite3`;
- Kysely;
- explicit SQL migrations;
- WAL mode, foreign keys и bounded busy timeout;
- explicit transactions и partial unique indexes.

Database constraints проверяются на настоящей временной SQLite, а не только mocks.

Транзакция SQLite не охватывает файловую систему. До удаления профилей по D-016 выбирается восстанавливаемый порядок изменения записи и каталога, включая сбой между шагами и повтор операции. Проверки миграций включают новую БД и обновление подготовленной БД предыдущей версии, когда такая версия появляется. До выпуска проверяются восстановление из резервной копии и согласованность метаданных с каталогами; реальные пользовательские данные не используются для этих тестов.

## Observability

- structured Pino logs;
- request/run/profile correlation IDs;
- mandatory redaction;
- typed failure codes и events;
- bounded run/event history;
- engine/app health;
- safe diagnostics export.

Prometheus/OpenTelemetry не входят в MVP без конкретного use case.

## Test boundaries

`FakeBrowserRuntime` должен конфигурируемо:

- задерживать launch/stop;
- падать до и после условного spawn;
- возвращать process metadata;
- испускать unexpected exit;
- зависать при stop;
- моделировать reconnectable/non-reconnectable process;
- фиксировать вызовы без secrets.

Обязательные уровни: transition unit tests, lifecycle tests с fake runtime/clock, SQLite integration tests, NestJS module tests, Fastify `inject()` integration tests, SSE integration tests, критические UI flows и отдельные Windows ShardX smoke tests.

Реальный ShardX не требуется для обычного unit/integration CI.

## Что ещё не подтверждено

Архитектура не считает доказанными:

- текущую версию и API ShardX;
- browser major и количество templates;
- process behavior после crash API;
- process markers, CDP recovery и tree termination;
- proxy fail-closed behavior и argv exposure;
- engine download/integrity behavior;
- fingerprint claims;
- end-to-end compatibility target toolchain, включая clean checkout, remote CI и dependency review.

Их статус ведётся в [risk-and-decision-log.md](risk-and-decision-log.md), а evidence — в `docs/spikes/`.

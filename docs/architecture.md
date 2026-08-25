# Архитектура Antidetect v2

> Статус: принятая целевая архитектура; реализация и поведение внешнего runtime ещё не подтверждены<br>
> Последняя ревизия: 2026-08-25<br>
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
- Docker, Redis, queues, workers, microservices и desktop shell не входят в MVP.

## Целевой стек

Baseline принят по состоянию на 12 августа 2026 года, но compatibility должна быть перепроверена перед установкой:

| Область | Принятая цель |
|---|---|
| Runtime | Node.js 24 LTS, ESM |
| Language | TypeScript 6.0.x |
| Workspace | pnpm 11 workspaces без Nx/Turborepo |
| Application framework | NestJS, feature modules и providers — зарегистрированные зависимости |
| HTTP provider | Fastify 5 через `@nestjs/platform-fastify` и `FastifyAdapter` |
| API contracts | Zod 4 как источник истины; точный NestJS bridge — связующий слой — открыт в `D-012` |
| API docs | OpenAPI через NestJS; точное отображение Zod-схем открыто в `D-012` и `D-010` |
| Logging | структурированные Pino-логи с обязательным redaction; конкретная NestJS-интеграция проверяется до добавления operational logs |
| Events | native SSE |
| Persistence | SQLite, `better-sqlite3`, Kysely, explicit SQL migrations |
| Frontend | React 19, Vite 8, React Router, TanStack Query |
| Forms/UI | React Hook Form, Zod, Tailwind CSS, shadcn/ui |
| Tests | Vitest, `@nestjs/testing`, Fastify `inject()`, Playwright UI tests |

Точная версия ShardX pin принимается только после Phase 0 dependency/API audit. Автоматическое обновление запрещено.

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

Для API Zod-схема является source of truth (источником истины), а TypeScript-типы выводятся из неё через `z.infer`. NestJS controllers получают схемы через единый связующий слой, который будет выбран по `D-012`; самостоятельные дублирующие DTO или `class-validator`-описания для тех же payload не создаются.

- Zod request/response schemas;
- DTO, выведенные из schemas;
- SSE event schemas;
- public error codes;
- общие enums/value types.

Database entities, ShardX types, NestJS controllers/providers и application services туда не помещаются.

Направление зависимостей:

```text
HTTP/UI -> application services -> domain rules/ports -> infrastructure adapters
```

Controllers выполняют validation, access/policy checks и mapping. Lifecycle logic в controllers запрещена. NestJS providers связывают application ports с реализациями, но не заменяют сами domain rules.

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

| Источник | Отвечает за | Не доказывает сам по себе |
|---|---|---|
| SQLite | Business metadata, durable invariants, run/event history | Что process жив |
| `app-data/profiles/<uuid>` | Frozen identity и Chromium data | Lifecycle status |
| In-memory registry | Живые handles, listeners и runtime control | Состояние после crash API |
| OS | Существование process и проверяемую identity | Принадлежность по одному PID |
| ShardX SDK | Launch/stop и low-level metadata | Наши concurrency/recovery guarantees |

Ни поле `running`, ни PID, ни in-memory handle не являются единственным источником истины.

## Domain records

### `profiles`

- server-generated UUID;
- display name и notes;
- immutable ShardX identity/template reference;
- runtime/filesystem metadata;
- optional proxy reference;
- timestamps.

Имя не участвует в filesystem path. Rename не перемещает directory. Смена fingerprint означает новую identity/clone, а не мутацию текущей.

Отдельный ненадёжный `profile.status` не хранится, если состояние можно вывести из active run и OS process.

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

```text
starting -> running -> stopping -> stopped
    |          |          |
    +--------> failed <---+
```

Разрешённые переходы:

- `starting -> running | failed`;
- `running -> stopping | failed`;
- `stopping -> stopped | failed`.

`stopped` — штатный terminal state. `failed` — нештатный terminal state или потеря безопасного управления.

Transitions задаются централизованно. Произвольные обновления status из routes или repositories запрещены.

## Lifecycle invariants

1. У profile не более одного run в `starting`, `running` или `stopping`.
2. Durable invariant обеспечивается SQLite partial unique index:

```sql
UNIQUE(profile_id)
WHERE status IN ('starting', 'running', 'stopping')
```

3. Per-profile mutex сериализует операции одного profile, но не заменяет database constraint.
4. Операции разных profiles не блокируются глобально.
5. Каждая launch attempt создаёт новый run.
6. Повторный `stop` безопасен и идемпотентен.
7. Running profile нельзя удалить.
8. Fingerprint identity immutable.
9. Filesystem path строится только из server-generated UUID.
10. Process принадлежит run только после проверки identity; одного PID недостаточно.
11. Foreign Chromium нельзя завершать или принимать за наш.
12. Частичный launch заканчивается cleanup либо явно обнаруживаемым orphan state.
13. Secrets не входят в run metadata, events или diagnostics.

## Start flow

**Принятая цель:**

1. Validate profile, engine state и proxy policy.
2. Acquire per-profile lock.
3. В SQLite transaction проверить отсутствие active run и создать `starting`.
4. Подготовить runtime input и UUID-based directory.
5. Запустить runtime.
6. Зарегистрировать handle и exit listener.
7. Сохранить process identity и перевести run в `running`.
8. Опубликовать redacted domain/SSE event.
9. При ошибке убрать частично созданный process либо зафиксировать обнаруживаемый orphan и перевести run в `failed`.
10. Release lock.

Conflict/idempotency и sync/async HTTP semantics определяются в `D-004`. Crash window между spawn и сохранением identity закрывается решением `D-006`.

## Stop flow

**Принятая цель:**

1. Acquire per-profile lock.
2. Найти active run и проверить реальный process.
3. Если process отсутствует, идемпотентно reconciliate stale state.
4. Перевести run в `stopping`.
5. Запросить graceful stop.
6. Дождаться exit с bounded timeout.
7. При необходимости применить hard kill только к проверенному process tree.
8. Проверить отсутствие process.
9. Перевести run в `stopped` либо `failed`.
10. Записать redacted event и release lock.

## Reconciliation

**Требования приняты, точная policy требует проверки.**

При старте API обрабатываются runs в `starting`, `running`, `stopping`:

- проверяется OS process и его identity;
- stale database state исправляется;
- lost handle не считается автоматически восстановимым;
- application-owned orphan обнаруживается по доказуемому marker;
- PID reuse не приводит к захвату или kill чужого process;
- результат фиксируется typed transition/event.

Policy для живого process без handle — reattach, controlled termination или quarantine — принимается только после Windows spike (`D-001`).

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

Точные routes, status codes и replay semantics определяются в `D-004`, `D-007`, `D-010`.

## Security invariants

1. API слушает только `127.0.0.1`/`::1`.
2. UI и API используют один origin; wildcard CORS запрещён.
3. `Host`/`Origin` проверяются согласно принятой localhost threat model.
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

Открытые security decisions: localhost access (`D-002`), credentials at rest (`D-003`), CDP exposure (`D-005`), engine integrity (`D-008`).

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
- compatibility target toolchain.

Их статус ведётся в [risk-and-decision-log.md](risk-and-decision-log.md), а evidence — в `docs/spikes/`.

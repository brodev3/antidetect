# План разработки Antidetect v2

> Статус: практический Phase 0 VM-spike закрыт 2026-08-21 через согласованную корректировку scope; наблюдения достаточны для foundation, но supply-chain и live-runtime gates остаются открыты
> Последняя ревизия: 2026-08-24
> Текущая контрольная точка: публичная orphan-ветка `v2/public-foundation` создана без legacy/prototype, личных заметок и архивных материалов; root commit `13855ac` содержит чистую V2-основу, практический Phase 0 VM-spike закрыт, а live ShardX adapter не разрешён.
> Авторитетен для: порядка реализации, phase gates и acceptance scenarios

Архитектура: [architecture.md](architecture.md). Границы продукта: [product-scope.md](product-scope.md).

## Исходное состояние

Legacy — старая версия, отброшенный TypeScript-прототип и пользовательские черновики сохранены только локально. Публичная ветка начинается с чистой основы v2. Решение зафиксировано в [ADR-0005](adr/0005-clean-v2-foundation.md).

До дальнейшей реализации нельзя:

- удалять legacy или discarded prototype;
- наследовать prototype internal APIs, database schema, package boundaries или старые tests;
- переносить prototype code, кроме отдельного небольшого self-contained фрагмента после review по ADR-0005;
- автоматически нормализовать dirty worktree;
- создавать checkpoint/tag/branch без подтверждения;
- повторно загружать или обновлять ShardX, а также менять зависимости, без отдельного согласования.

## Условия до Phase 0

До выполнения экспериментов Phase 0 последовательно требуется:

1. [x] Согласовать точную форму и состав снимка сохранения текущего legacy/prototype состояния.
2. [x] После отдельного разрешения создать и проверить снимок `cebcc68` и метку `pre-v2-preservation-2026-08-19`.
3. [x] Согласовать одноразовую виртуальную машину Windows x64 как единственную среду выполнения Phase 0 и создать локальную ветку `spike/shardx-phase-0-vm`.
4. [x] Проверить фактическую конфигурацию выключенной виртуальной машины и применить согласованную изоляцию Hyper-V.
5. [x] После перезапуска основной системы повторно подтвердить статус и критичные настройки виртуальной машины из административного сеанса.
6. [x] Автономно определить редакцию, сборку, базовую защиту и лицензионное состояние обновлений гостевой Windows.
7. [x] Явно принять отсутствие ESU как остаточный риск только для одноразовой изолированной Phase 0 по ADR-0006.
8. [x] Выполнить автономные отрицательные сетевые тесты гостевой Windows и повторно подтвердить ограничения сети на основной системе.
9. [x] Проверить гостевые службы и отсутствие личных данных, подтвердить защиту основной системы, затем создать исходную контрольную точку.
10. [x] Получить отдельное разрешение на ограниченный VM-эксперимент: временный сетевой выход, загрузку SDK, первую установку runtime и первый запуск ShardX. Фактический публичный IPv4 остаётся широким, а не allowlist-моделью.

Preservation checkpoint необходим, но сам по себе не разрешает cleanup. Удаление или архивирование legacy/prototype не входит в Phase 0 и требует отдельного именованного решения. Изолированное окружение Phase 0 служит только для spike; clean production v2 branch/workspace создаётся в Phase 1 после явного `go`.

## Принципы выполнения

- Работать короткими проверяемыми фазами, разбитыми на небольшие reviewable шаги.
- Один шаг по возможности решает одну задачу, раскрывает одну основную учебную тему и заканчивается отдельной проверкой.
- После каждого смыслового diff разбирать результат с пользователем и останавливаться перед следующим изменением.
- Не строить полный CRUD/UI до проверки ShardX.
- Разделять факты, target и hypotheses.
- Не добавлять инфраструктуру без доказанной необходимости.
- Каждая фаза заканчивается проверками, артефактами и явным gate.
- Следующая фаза не начинается при незакрытом критичном gate.

## Состояние фаз

| Этап | Статус | Exit gate |
|---|---|---|
| Documentation baseline | Завершён | Активный контекст отделён от архива |
| Phase 0 — аудит репозитория и эксперимент ShardX | Практический VM-spike закрыт 21.08.2026 через `GO WITH SCOPE CHANGE`; core lifecycle/process evidence собран, непроверенные сценарии перенесены в дальнейшие gates | Scope adjustment принят; Phase 1 допускается только после отдельного `go` и без live ShardX integration |
| Phase 1 — foundation | В работе: 24.08.2026 создана публичная orphan-ветка `v2/public-foundation`, зафиксирован root commit `13855ac`; следующий шаг — воспроизводимая установка и проверки clean V2 foundation | Чистый workspace воспроизводимо собирается и проверяется |
| Phase 2 — persistence/domain | Не начат | Lifecycle invariants обеспечены SQLite и тестами |
| Phase 3 — lifecycle через fake runtime | Не начат | Concurrency/failure paths проходят deterministic tests |
| Phase 4 — ShardX adapter | Не начат | Реальный Windows smoke flow работает |
| Phase 5 — reconciliation | Не начат | Restart/lost-process policy доказана |
| Phase 6 — API/SSE/UI | Не начат | Полный local MVP flow работает через public boundary |
| Phase 7 — hardening/release | Не начат | Clean install, CI, docs и demo воспроизводимы |

## Documentation baseline — завершён

Артефакты:

- карта активной документации;
- отдельные current state, product scope, architecture, plan и decision/risk log;
- прежние ADR помечены superseded;
- target behavior явно отделено от implemented behavior.

Gate: новый агент может выбрать нужный контекст, не читая 934-строчный handoff.

## Phase 0 — repository audit и ShardX spike

Цели:

- сохранить legacy/prototype неизменными и использовать только согласованное изолированное spike-окружение;
- выполнять ShardX только в одноразовой виртуальной машине Windows x64 без личных данных, общих папок и секретов основной системы;
- маркировать результаты, зависящие от виртуализации, и не переносить их автоматически на физическую Windows;
- проверить актуальные ShardX SDK API, dependencies и terms;
- выполнить минимальный Windows launch;
- проверить persistent profile, proxy, CDP, stop и unexpected exit;
- исследовать crash/restart, process identity и process-tree termination;
- определить возможность reattach;
- проверить engine download, timeout и concurrent first install;
- проверить заявленные fingerprint surfaces black-box методом.

Артефакты:

- заполненный `docs/spikes/phase-0-shardx.md`;
- dependency/licensing evidence;
- подтверждённые runtime limitations;
- принятое recovery решение или явный blocker;
- обновлённые ADR/architecture/decision log.

Exit gate:

- понятно, как spawned browser идентифицируется, отслеживается, останавливается и обрабатывается после падения API;
- proxy fail-closed behavior проверено фактическим external-IP experiment;
- небезопасные предположения удалены;
- принято явное `go`, `scope adjustment` или `no-go`.

До закрытия gate нельзя начинать широкую реализацию v2.

### Scope adjustment от 2026-08-21

Пользователь закрыл практический VM-spike после получения достаточного evidence о lifecycle, process identity, orphan behavior, CDP и proxy failure. Полный исследовательский список не является условием для clean foundation: после отдельного `go` можно начать Phase 1 с `FakeBrowserRuntime` — тестовой заменой реального runtime — и без загрузки/запуска ShardX.

Это не отменяет gates: D-008 остаётся до controlled engine installation, D-005/A-009 — до live CDP/proxy flow, D-006 — до reconciliation, а D-011/A-012 — до заявлений о fingerprint surfaces. Live `ShardXRuntime` не начинается, пока соответствующие решения не приняты отдельно.

## Phase 1 — foundation

Цели:

- создать согласованный v2 branch/workspace;
- создать clean v2 foundation без миграции prototype internals;
- настроить approved Node/TypeScript/ESM/pnpm baseline;
- создать минимальные API, web и contracts boundaries;
- зафиксировать Zod 4 как источник истины API-схем и `fastify-type-provider-zod` как Fastify-адаптер;
- зафиксировать Vitest как тестовую основу (baseline) для unit/integration-проверок;
- выбрать config/application-data directories;
- добавить format, lint, typecheck, build, tests и CI skeleton;
- исключить secrets и engine binaries из Git.

Exit gate:

- clean checkout воспроизводимо устанавливается;
- доступные checks проходят;
- API и web skeleton запускаются локально;
- команды задокументированы и проверены.

## Phase 2 — persistence/domain

Цели:

- реализовать explicit migrations;
- добавить profiles, proxies, browser runs и events;
- централизовать states и transitions;
- обеспечить single-active-run invariant;
- реализовать repositories/transactions без лишних abstractions;
- проверить реальные constraints и rollback.

Exit gate:

- два active runs одного profile физически невозможны;
- migrations работают на новой database;
- invalid transitions отклоняются;
- SQLite integration tests проходят.

## Phase 3 — lifecycle через fake runtime

Цели:

- определить application-owned `BrowserRuntime`;
- реализовать управляемый `FakeBrowserRuntime`;
- добавить per-profile locks;
- реализовать start, stop, exit handling и events;
- внедрить launch/stop/timeout/unexpected-exit failures;
- детерминированно проверить concurrency и idempotency.

Exit gate:

- concurrent start одного profile вызывает не более одного launch;
- разные profiles выполняются независимо;
- repeated stop безопасен;
- partial launch failure очищается или оставляет обнаруживаемое состояние;
- lifecycle tests не требуют Chromium.

## Phase 4 — ShardX adapter

Цели:

- реализовать изолированный `ShardXRuntime`;
- добавить controlled engine status/installation;
- сопоставить application profiles с ShardX inputs;
- зарегистрировать handles и exit listeners;
- выполнить redaction runtime data;
- пройти реальный Windows smoke flow.

Exit gate:

- application создаёт, запускает, сохраняет и останавливает реальный ShardX profile;
- unexpected exit наблюдается;
- secrets отсутствуют в diagnostics;
- smoke procedure повторяема.

## Phase 5 — reconciliation

Цели:

- инспектировать OS processes при startup;
- защититься от PID reuse;
- исправлять stale active runs;
- обрабатывать lost handles и spawn crash window;
- находить application-owned orphans, не затрагивая чужой Chromium;
- реализовать принятую после Phase 0 recovery policy.

Exit gate:

- restart behavior детерминирован для каждого active state;
- missing process исправляет stale state;
- reused PID отклоняется;
- live uncontrollable process следует documented safe policy;
- Windows recovery scenarios проверены.

## Phase 6 — API, SSE и UI

Цели:

- открыть profile/proxy/engine/run operations;
- реализовать typed validation/errors и OpenAPI;
- добавить SSE reconnect behavior;
- собрать полный local MVP user flow;
- добавить критические Playwright UI tests.

Exit gate:

- пользователь проходит MVP flow через UI;
- lifecycle logic отсутствует в handlers;
- SSE не становится source of truth;
- API/events/UI contracts согласованы;
- validation, conflict, not-found и runtime failures покрыты.

## Phase 7 — hardening и release

Цели:

- выполнить focused security review;
- повторить dependency и engine-integrity checks;
- проверить redaction logs/diagnostics;
- принять retention policy;
- завершить README, ADR, setup, troubleshooting и attribution;
- проверить clean Windows installation;
- завершить CI и demo scenario.

Exit gate:

- обязательные checks проходят либо external blockers документированы;
- clean install и demo воспроизводимы;
- secrets и engine binary отсутствуют в source/release artifacts;
- public claims соответствуют проверенному поведению;
- remaining risks явно перечислены.

## Acceptance scenarios MVP

Перед завершением MVP проверить:

1. Два concurrent starts одного profile создают не более одного browser.
2. Starts разных profiles не используют global lock.
3. Падение API во время `starting` приводит к documented recovery.
4. External browser termination обновляет state.
5. Active DB record без process reconciliate в terminal state.
6. Live process с потерянным handle следует принятой recovery policy.
7. Reused PID не принимается за наш browser.
8. Proxy failure не вызывает silent direct fallback.
9. Proxy password отсутствует в API, SSE, logs, OpenAPI, errors и snapshots.
10. Повторный stop безопасен и идемпотентен.
11. Failure после spawn не оставляет permanent unmanaged orphan.
12. Running profile нельзя удалить.
13. Concurrent operations сохраняют DB и registry invariants.
14. UI/SSE reconnect восстанавливает истину через GET.
15. Interrupted engine installation не считается healthy installation.

Каждый сценарий автоматизируется, где это практично. OS/real-engine behavior подтверждается отдельными Windows integration/smoke tests.

## Checklist завершения фазы

- Проверить changed files и diff.
- Убедиться, что unrelated user changes не затронуты.
- Запустить все релевантные доступные checks.
- Записать точные команды и результаты.
- Обновить статус фазы.
- Обновить architecture/ADR только при изменении решения.
- Обновить учебный прогресс только по фактическому checkpoint и evidence.
- Создать или уточнить тематическую заметку, если на фазе действительно изучалась новая тема.
- Добавить подтверждённые тезисы, вопросы и demo evidence в комплект защиты.
- Перечислить remaining risks и следующий gate.
- Остановиться для подтверждения перед расширением scope.

## Schedule cutline

При нехватке времени сокращать по порядку:

1. декоративный UI;
2. вторичные filters и presentation diagnostics;
3. некритичное e2e coverage;
4. post-MVP convenience functions.

Не сокращать double-start protection, process verification, recovery policy, safe stop, proxy fail-closed, credential redaction, database invariant tests и deterministic lifecycle failure tests.

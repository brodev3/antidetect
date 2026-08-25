# ADR-0003: Локальный control plane для v2

Статус: Accepted target; выбор API framework изменён ADR-0007

Дата: 2026-08-13

Дополнение от 2026-08-25: [ADR-0007](0007-nestjs-over-fastify.md) заменяет только выбор прямого Fastify API. Fastify остаётся HTTP provider через `FastifyAdapter`, а application framework — каркасом приложения — становится NestJS. Остальные решения этого ADR сохраняются.

## Контекст

Antidetect v2 создаётся как публичная портфельная демонстрация нашего исходного кода и личный некоммерческий инструмент для одного локального пользователя на Windows x64. Публичность репозитория не распространяется на сторонний ShardX engine: его нельзя включать в Git, сборку или дистрибутив проекта.

Главная инженерная задача — надёжно управлять реальными browser processes: обеспечить один active run на profile, отслеживать exits, восстанавливать состояние после crash, защищать credentials и тестировать race/failure paths.

Предыдущая target architecture предполагала PostgreSQL, Redis, BullMQ, отдельный worker и OpenTelemetry. Для local single-user продукта эта инфраструктура добавляет установку, эксплуатацию и distributed failure modes, не решая основную задачу.

## Решение

Принять для MVP:

- local-first и API-first модель;
- Windows x64 как основную платформу;
- один локальный Node.js control-plane process;
- Fastify API, раздающий собранный React SPA с того же origin;
- loopback-only network boundary;
- SQLite с Kysely, `better-sqlite3` и explicit SQL migrations;
- native SSE для server-to-UI updates;
- pnpm workspaces без Nx/Turborepo;
- modular monolith без отдельного worker/queue.

В MVP не добавлять Redis, BullMQ, PostgreSQL, microservices, Kubernetes, Docker-first deployment, Electron/Tauri или OpenTelemetry без нового доказанного требования.

Точные framework/package versions перепроверяются перед установкой. Это решение фиксирует architecture baseline, а не подтверждает compatibility текущих версий.

## Причины

- SQLite соответствует одному локальному process и упрощает установку.
- Kysely позволяет явно задавать transactions и partial indexes.
- Один process делает per-profile in-memory coordination понятной, а durable invariant остаётся в SQLite.
- Fastify подходит небольшому API-first service без лишней framework ceremony.
- SSE соответствует преимущественно однонаправленному потоку server-to-UI.
- Исключение distributed infrastructure сохраняет фокус на lifecycle, recovery, security и tests.

## Альтернативы

### PostgreSQL + Redis/BullMQ + worker

Отложено. Подходит многопроцессной или распределённой системе, но не даёт продуктовой выгоды MVP и усложняет recovery model.

### Desktop shell с самого начала

Отложено. Tauri/Electron добавляют packaging, update и второй runtime до готовности core application.

### Docker-first

Отклонено для основного запуска. ShardX управляет нативным GUI Chromium и OS processes; container не отражает production behavior продукта.

## Последствия

Плюсы:

- минимальная операционная поверхность;
- простой clean-install target;
- явная single-process concurrency model;
- больше времени на ключевые failure scenarios.

Ограничения:

- решение не рассчитано на distributed/multi-host coordination;
- Windows-specific process behavior требует отдельного smoke/integration contour;
- при переходе к нескольким control-plane processes architecture и invariants пересматриваются.

## Не закрытые этим ADR вопросы

- localhost API access model (`D-002`);
- storage proxy credentials (`D-003`);
- data directories (`D-009`);
- точные routes/error mapping (`D-010`).

Они остаются в `docs/risk-and-decision-log.md`.

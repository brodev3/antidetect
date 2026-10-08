# Реестр архитектурных решений (ADR)

> Статус: активный индекс
> Последняя ревизия: 2026-10-02

ADR фиксирует существенное принятое решение: контекст, выбор, альтернативы и последствия. Progress, task list, vendor claims и открытые вопросы в ADR не хранятся.

## Индекс

| ADR | Статус | Назначение |
|---|---|---|
| [0001 — Modular monorepo](0001-modular-monorepo.md) | Superseded | История TypeScript-миграции v1 |
| [0002 — Playwright/Bablosoft runner](0002-runner.md) | Superseded | История legacy runtime boundary |
| [0003 — V2 local control plane](0003-v2-local-control-plane.md) | Accepted target; API framework amended by ADR-0007 | Deployment и infrastructure baseline v2 |
| [0004 — ShardX runtime boundary](0004-shardx-runtime-boundary.md) | Accepted target | Граница стороннего engine и нашего control plane |
| [0005 — Clean v2 foundation](0005-clean-v2-foundation.md) | Accepted | Отказ от продолжения TypeScript-прототипа и правила точечного reuse |
| [0006 — Phase 0 Windows 10 residual risk](0006-phase-0-windows-10-residual-risk.md) | Accepted | Допуск Windows 10 без ESU только в одноразовой изолированной Phase 0 |
| [0007 — NestJS over Fastify](0007-nestjs-over-fastify.md) | Accepted target | NestJS modules/DI поверх Fastify HTTP provider без framework coupling ядра |
| [0008 — Zod/OpenAPI bridge](0008-zod-openapi-bridge.md) | Accepted and implemented | Единая runtime-проверка Zod и OpenAPI-интеграция в NestJS |
| [0009 — Durable profile occupancy](0009-durable-profile-occupancy.md) | Сохраняемая занятость и восстановление с тестовой заменой движка реализованы; реальные процессы требуют проверки | Сохраняемая занятость профиля при потере управления браузером; схема и базовый lifecycle-сервис приняты в D-014 |
| [0010 — SQLite exclusive root ownership](0010-sqlite-exclusive-root-ownership.md) | Root ownership, shared SQLite/Kysely, миграции и локальный startup gate реализованы | Один API владеет всем `ANTIDETECT_HOME` через эксклюзивную блокировку основного SQLite-соединения; process-aware recovery и remote CI остаются открыты |
| [0011 — Localhost request policy](0011-localhost-request-policy.md) | Базовое решение; Origin уточнён ADR-0016 | Literal loopback, строгие `Host`/`Origin` и fail-closed startup для внешнего `API_HOST` |
| [0012 — Browser-run occupancy](0012-browser-run-occupancy.md) | Схема и профильная занятость реализованы; восстановление процессов открыто; глобальная блокировка запуска API заменена 2026-09-26 | Отдельная `browser_runs`, блокирующие статусы, проверка переходов и частичный уникальный индекс на один активный run профиля |
| [0013 — Profile HTTP contract](0013-profile-http-contract.md) | Принято и реализовано для profile API/UI; необязательный режим отпечатка поддержан в тестовом срезе | Создание/чтение профиля, ограниченный список, ошибки, стабильный пользовательский код и граница доступа |
| [0014 — Local session boundary](0014-local-session-boundary.md) | Принято и реализовано для API-маршрутов; Origin уточнён ADR-0016 | Непрозрачная сессионная cookie в памяти для локального браузерного клиента; без проверки программ средствами ОС |
| [0015 — Asynchronous browser-run commands](0015-asynchronous-browser-run-commands.md) | Принято и реализовано для тестового API-среза | `202` Start/Stop, быстрый конфликт во время запуска, GET последнего запуска и сохранение занятости при неопределённости |
| [0016 — Browser Origin policy](0016-browser-origin-policy.md) | Принято и реализовано | Явно разрешённые origins UI и обязательный Origin для запросов, меняющих состояние; локальные процессы не аутентифицируются |

## Правила

- Новый ADR создаётся только после фактического решения.
- Нерешённые вопросы остаются в `docs/risk-and-decision-log.md`.
- Если решение заменено, старый ADR не удаляется: получает `Superseded` и ссылку на новый.
- Реализация решения отдельно подтверждается кодом и tests; статус `Accepted` не означает `Implemented`.
- Изменение принятого security, persistence, runtime, public API или deployment решения требует подтверждения пользователя.

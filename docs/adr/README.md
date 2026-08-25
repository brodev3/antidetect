# Реестр архитектурных решений (ADR)

> Статус: активный индекс
> Последняя ревизия: 2026-08-25

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

## Правила

- Новый ADR создаётся только после фактического решения.
- Нерешённые вопросы остаются в `docs/risk-and-decision-log.md`.
- Если решение заменено, старый ADR не удаляется: получает `Superseded` и ссылку на новый.
- Реализация решения отдельно подтверждается кодом и tests; статус `Accepted` не означает `Implemented`.
- Изменение принятого security, persistence, runtime, public API или deployment решения требует подтверждения пользователя.

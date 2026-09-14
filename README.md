# Antidetect v2

> Статус на 15 сентября 2026 года: локальный Phase 1 gate закрыт на чистом checkout `8549bb3`; после него локально подтверждены root ownership, bounded shutdown, базовая localhost request policy и shared SQLite/Kysely boundary. Публичная ветка содержит проверяемую TypeScript-основу, NestJS `/health` поверх Fastify, quality tooling — инструменты качества — и статический React/Vite web skeleton. ShardX integration и продуктовый persistence-код отсутствуют; remote CI ожидает отдельной публикации ветки.

Antidetect v2 — планируемый local-first, API-first orchestrator браузерных профилей на Node.js/TypeScript для Windows x64.

ShardX должен предоставлять сторонний patched Chromium и fingerprint runtime. Инженерная ценность этого проекта находится в control plane вокруг него:

- надёжный lifecycle браузерных процессов;
- защита от двойного запуска;
- восстановление и reconciliation после сбоев;
- безопасная работа с proxy credentials;
- typed API и события;
- детерминированные concurrency/failure tests;
- локальный React UI и диагностика.

Проект не выдаёт fingerprint-движок ShardX за собственную разработку.

## Принципы разработки

Разработка идёт небольшими проверяемыми шагами: один результат, минимальный связный diff, проверка и документирование существенных решений.

## Что находится в репозитории сейчас

Эта ветка содержит только чистую основу Antidetect v2. Уже созданы pnpm workspace, TypeScript baseline, пакет API-контрактов на Zod, минимальный NestJS `/health` поверх Fastify с тестами, статический React/Vite web skeleton — минимальный каркас интерфейса — format/lint/build-команды и CI skeleton — каркас автоматических проверок. Legacy v1, отброшенный TypeScript-прототип и личные рабочие материалы не входят в её историю.

ShardX integration, целевой persistence layer, lifecycle state machine, process recovery, SSE и продуктовая логика web UI ещё не реализованы. Точное фактическое состояние зафиксировано в [docs/current-state.md](docs/current-state.md).

## Целевой MVP

Целевой MVP должен позволять локальному пользователю:

- создавать и хранить ShardX profiles;
- назначать и проверять proxy без утечки credentials;
- запускать profile интерактивно или для automation;
- безопасно и идемпотентно останавливать browser process tree;
- видеть актуальное состояние, историю запусков и typed failures;
- восстанавливать согласованное состояние после падения API;
- работать через локальные API и web UI.

Полный scope и исключения: [docs/product-scope.md](docs/product-scope.md).

## Документация

- [Карта документации](docs/README.md)
- [Текущее состояние](docs/current-state.md)
- [Границы продукта и MVP](docs/product-scope.md)
- [Целевая архитектура](docs/architecture.md)
- [План разработки](docs/development-plan.md)
- [Открытые решения, предположения и риски](docs/risk-and-decision-log.md)
- [ADR](docs/adr/README.md)
- [Шаблон Phase 0 ShardX spike](docs/spikes/phase-0-shardx.md)

## Запуск и проверки

Корневой pnpm-workspace и TypeScript baseline уже созданы. Тестовая основа (baseline) — Vitest (фреймворк для unit- и integration-тестов, то есть модульных и интеграционных проверок); обычные API-тесты используют Fastify `inject()` без запуска сетевого порта, а отдельный `test:integration` запускает собранный API в реальных Node.js-процессах. API-контракты используют Zod 4 как источник истины.

По [ADR-0007](docs/adr/0007-nestjs-over-fastify.md) NestJS уже используется как application framework — каркас приложения — поверх Fastify через `FastifyAdapter` для `/health`. Runtime-проверка Zod подключена через `nestjs-zod`, а OpenAPI — через `@nestjs/swagger` с JSON-документом на `/docs-json`; выбор зафиксирован в [ADR-0008](docs/adr/0008-zod-openapi-bridge.md). Тест сохраняет Zod-контракт, Vitest и Fastify `inject()` без запуска сетевого порта.

Проверяемые команды foundation (основы проекта):

Предпосылка: нужен Node.js 24 с включённым Corepack — встроенным механизмом выбора версий package manager. Clean checkout `8549bb3` проверен на Node.js `24.18.0` и pnpm `11.16.0`; CI ориентирован на Node.js `24.19.0`. Политика LF зафиксирована в `.gitattributes`.

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run format:check
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run build
corepack pnpm run test:integration
```

Эти команды проверяют foundation: форматирование, статический анализ, типы, unit-тесты и компиляцию; `test:integration` дополнительно проверяет startup ownership через реальные API-процессы. На clean checkout `8549bb3` базовые команды прошли; после него локальный integration gate также прошёл три раза, а общий и production `pnpm audit` вернули `No known vulnerabilities found`. `build` собирает contracts, API и web в пакетные каталоги `packages/contracts/dist`, `apps/api/dist` и `apps/web/dist`. API можно запустить командой `pnpm --filter @antidetect/api start` и проверить `GET http://127.0.0.1:3000/health`; web skeleton — командой `pnpm --filter @antidetect/web dev` и открыть `http://127.0.0.1:5173/`. Web пока содержит только статические demo profiles — демонстрационные профили — и не вызывает API. По умолчанию используются `API_HOST=127.0.0.1` и `API_PORT=3000`; пример переменных находится в `.env.example` и сам по себе не загружается автоматически. API и web smoke из clean checkout подтверждены 2026-09-13. Полноценный UI и live ShardX runtime (живой запуск среды выполнения ShardX) будут добавляться отдельными шагами. CI workflow запускает базовый набор проверок на GitHub; удалённый запуск ещё не подтверждён push-операцией. Старую инструкцию `npm install && node index` нельзя считать инструкцией для v2.

## ShardX и лицензирование

ShardX — сторонний closed-source engine с отдельными условиями использования. В целевой интеграции его binary:

- не включается в Git или release archive;
- не зеркалируется;
- загружается только поддерживаемым официальным способом;
- явно отделяется от MIT-лицензии нашего исходного кода.

В handoff зафиксировано, что авторы разрешили некоммерческую open-source интеграцию, однако подтверждение и актуальные условия должны быть сохранены и повторно проверены до распространения v2. Перед коммерческим использованием требуется отдельное разрешение.

## Лицензия

Собственный исходный код репозитория распространяется по [MIT License](LICENSE). Это не изменяет и не заменяет отдельные условия ShardX engine и других сторонних компонентов.

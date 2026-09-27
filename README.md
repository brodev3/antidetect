# Antidetect v2

> Статус на 27 сентября 2026 года: локальные технические gates Phase 2 и Phase 3 пройдены. Start/Stop и чтение состояния проверены через отдельный тестовый режим с `FakeBrowserRuntime` — подменной средой выполнения, которая не запускает настоящий браузер. Обычный API не подключает эту подмену; интеграция ShardX и проверка реальных процессов не начаты. Текущий снимок ещё не проверен удалённым CI.

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

Эта ветка содержит только чистую основу Antidetect v2. Уже созданы pnpm workspace, TypeScript baseline, пакет API-контрактов на Zod, NestJS/Fastify API, React/Vite web skeleton — минимальный каркас интерфейса, — format/lint/build-команды и CI skeleton — каркас автоматических проверок. Legacy v1, отброшенный TypeScript-прототип и личные рабочие материалы не входят в её историю.

Также реализованы SQLite/Kysely-хранилище, явные миграции, репозитории профилей и запусков, проверка переходов статусов, блокировка операций одного профиля и защита от второго владельца корня данных. Профиль можно создать с включённым отпечатком по умолчанию или без него; тестовый API-срез позволяет переключить режим только у свободного профиля. Команды `Start`/`Stop` и чтение состояния доступны через отдельный API/UI-режим `FakeBrowserRuntime`. Это проверяет правила приложения и интерфейс, но не запускает браузер и не проверяет процессы ОС. Неопределённый запуск сохраняет занятость конкретного профиля, не блокируя весь API. Обычный `main.ts` не подключает fake runtime; настоящий адаптер, SSE и интеграция ShardX ещё не реализованы. Точное состояние зафиксировано в [docs/current-state.md](docs/current-state.md).

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
- [Статический аудит доставки ShardX SDK 2.0.3](docs/spikes/shardx-sdk-2.0.3-static-audit.md)

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

Последняя локальная проверка 27.09.2026 на Node.js `24.18.0` и pnpm `11.16.0`: `format:check`, `lint`, `typecheck`, 207 тестов, production build и `test:integration` (4/4 сценария) прошли. В этой проверке frozen install и dependency audit повторно не запускались; удалённый CI текущего снимка не подтверждён. `build` собирает contracts, API и web в `packages/contracts/dist`, `apps/api/dist` и `apps/web/dist`. API запускается через `pnpm --filter @antidetect/api start`, web — `pnpm --filter @antidetect/web dev`. Чтобы проверить команды с подменным движком, запусти `corepack pnpm run dev:fake-api`, отдельно запусти web и открой `http://127.0.0.1:5173/?fake-runtime`. Тестовый API занимает порт 3000, не запускай его одновременно с обычным API; профили и состояния запусков хранятся только в памяти, настоящий браузер и SQLite не используются. Обычный API использует `API_HOST=127.0.0.1` и `API_PORT=3000`; пример переменных находится в `.env.example` и сам по себе не загружается автоматически. CI настроен для Ubuntu и Windows, но этот локальный результат ещё не является удалённым CI. Старую инструкцию `npm install && node index` нельзя считать инструкцией для v2.

## ShardX и лицензирование

ShardX — сторонний closed-source engine с отдельными условиями использования. В целевой интеграции его binary:

- не включается в Git или release archive;
- не зеркалируется;
- загружается только поддерживаемым официальным способом;
- явно отделяется от MIT-лицензии нашего исходного кода.

В handoff зафиксировано, что авторы разрешили некоммерческую open-source интеграцию, однако подтверждение и актуальные условия должны быть сохранены и повторно проверены до распространения v2. Перед коммерческим использованием требуется отдельное разрешение.

## Лицензия

Собственный исходный код репозитория распространяется по [MIT License](LICENSE). Это не изменяет и не заменяет отдельные условия ShardX engine и других сторонних компонентов.

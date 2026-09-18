# ADR-0007: NestJS как application framework поверх Fastify

Статус: Accepted target

Дата: 2026-08-25

## Контекст

Phase 1 содержит минимальную NestJS/Fastify-основу: `/health`, Zod response contract и Vitest integration test через `inject()`. В Phase 2 уже добавлены application ports, SQLite persistence и базовый browser-run lifecycle-сервис, но product modules/routes ещё не подключены. Поэтому смена API-каркаса по-прежнему не требует миграции product HTTP-логики.

Целевой control plane будет включать profiles, browser lifecycle, runtime adapters, persistence, events, API и UI boundary. Проект одновременно служит практическим учебным и портфельным примером, поэтому важно показать не только HTTP route, но и осознанное применение modules, dependency injection — внедрения зависимостей — и test overrides — тестовых подмен.

## Решение

- Использовать NestJS как application framework — каркас приложения — в `apps/api`.
- Использовать Fastify как HTTP provider — HTTP-движок — через `@nestjs/platform-fastify` и `FastifyAdapter`.
- Сохранять modular monolith: NestJS feature modules группируются по возможностям продукта, а не по каждой библиотеке или классу.
- Оставлять domain/application rules независимыми от NestJS decorators и Fastify types.
- Регистрировать `BrowserRuntime`, repositories, clock и другие ports через explicit provider tokens — явные ключи зависимостей.
- Сохранять Zod 4 источником истины API contracts. Выбранный bridge для validation, serialization и OpenAPI зафиксирован в [ADR-0008](0008-zod-openapi-bridge.md); независимые дублирующие DTO-схемы не допускаются.
- Сохранять Vitest тестовой основой. Для NestJS composition использовать `@nestjs/testing`, а HTTP integration tests выполнять через Fastify `inject()`.
- Не считать NestJS modules системой динамических browser plugins. ShardX, будущий Bablosoft или тестовый Chromium остаются infrastructure adapters одного нашего `BrowserRuntime` contract.

Минимальный NestJS bootstrap, `/health` и Zod/OpenAPI bridge реализованы и проверены в foundation history. Этот ADR не утверждает, что product modules/routes, recovery или реальный browser runtime уже реализованы.

## Причины

- Feature modules дают явные границы profiles, lifecycle, runtimes, persistence и events.
- Dependency injection упрощает замену реального runtime и database adapters на deterministic fakes в tests.
- Fastify сохраняет уже изученный HTTP lifecycle и возможность `inject()` tests без сетевого порта.
- Проект получает содержательный NestJS use case, а не демонстрационный CRUD — набор простых операций создания, чтения, изменения и удаления.
- Решение принято до появления продуктовых controllers и services, поэтому стоимость перехода ограничена foundation-каркасом.

## Альтернативы

### Продолжить с прямым Fastify

Это минимальный по количеству abstractions вариант и первоначальная цель ADR-0003. Он остаётся технически допустимым, но выбранная учебная цель и ожидаемое число независимых application boundaries делают NestJS оправданным дополнительным слоем.

### NestJS с Express по умолчанию

Отклонено. Проект уже проверил Fastify lifecycle и `inject()`, а переход на Express не даёт продуктовой выгоды.

### Использовать NestJS decorators внутри domain/application code

Отклонено. Это свяжет бизнес-правила с framework, усложнит изолированные тесты и ослабит ports/adapters boundary.

## Последствия

Плюсы:

- единая module graph — схема зависимостей модулей;
- явные provider tokens и удобные test overrides;
- узнаваемая production-oriented структура для обучения и портфолио;
- сохранение Fastify как HTTP provider.

Ограничения:

- появляются NestJS bootstrap, decorators, lifecycle hooks и дополнительные зависимости;
- необходимо отдельно проверить совместимость Node.js, TypeScript, NestJS и Fastify;
- текущая интеграция `fastify-type-provider-zod` не переносится автоматически в NestJS controllers;
- framework lifecycle нельзя смешивать с состоянием browser run или OS process.

## Не закрытые этим ADR вопросы

- детали Zod/serialization/OpenAPI integration вынесены в [ADR-0008](0008-zod-openapi-bridge.md);
- logging/redaction integration (`D-013`);
- финальные routes и error mapping (`D-010`);
- совместимость выбранных major versions (`A-013`).

Они остаются в `docs/risk-and-decision-log.md`.

# ADR-0008: единый Zod bridge для NestJS и OpenAPI

> Статус: Accepted and implemented
> Дата: 2026-08-25

## Контекст

V2 использует Zod 4 как единственный источник истины для API-контрактов. После выбора NestJS поверх Fastify требовался runtime bridge — связующий слой между Zod-схемами, NestJS pipes/interceptor и OpenAPI. Нельзя создавать отдельные class-validator DTO для тех же payload.

## Решение

- Использовать `nestjs-zod@5.5.0` для `ZodValidationPipe` — проверки входных данных — и `ZodSerializerInterceptor` — проверки ответов.
- Описывать response boundary через `@ZodResponse`; схема берётся из `packages/contracts`.
- Использовать `createZodDto` только как NestJS metadata adapter — адаптер метаданных, а не копию схемы.
- Использовать `@nestjs/swagger@11.2.0` для OpenAPI document generation — генерации документа.
- Применять `cleanupOpenApiDoc` перед публикацией документа.
- На foundation-этапе публиковать только JSON OpenAPI на `/docs-json`; Swagger UI отложен, чтобы не добавлять статические Fastify-ассеты до отдельного решения.
- Удалить прямую зависимость `fastify-type-provider-zod`: после перехода на NestJS validation boundary принадлежит NestJS.

## Почему не собственный bridge

Собственные pipe, interceptor и OpenAPI metadata потребовали бы поддерживать ещё один framework-specific слой и вручную синхронизировать документацию. Библиотека уже закрывает эти обязанности и поддерживает NestJS 10/11 и Zod 3.25+/4.

## Последствия

Положительные:

- одна Zod-схема задаёт runtime-проверку, TypeScript type и OpenAPI representation;
- response serialization защищает boundary от случайной утечки полей;
- NestJS module graph остаётся стандартным и тестируемым через Fastify `inject()`.

Ограничения:

- `nestjs-zod` становится частью API boundary и должен быть закреплён lockfile;
- UI Swagger не включён на foundation-этапе;
- финальные routes, error envelope и security policy остаются отдельными решениями.

## Evidence

Commit `7202418` содержит bridge, `/docs-json` и тесты. `typecheck` проходит; Vitest: 2 файла, 4 теста.

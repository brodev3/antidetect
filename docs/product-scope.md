# Границы продукта Antidetect v2

> Статус: принятая продуктовая цель; реализация не подтверждена<br>
> Последняя ревизия: 2026-09-13<br>
> Авторитетен для: назначения продукта, MVP и non-goals
> Не авторитетен для: текущего состояния, схемы БД и деталей реализации

## Позиционирование

Antidetect v2 — Windows-first, local-first orchestrator браузерных профилей на Node.js/TypeScript.

ShardX предоставляет сторонний patched Chromium и fingerprint runtime. Наш проект создаёт control plane вокруг него:

- profile и proxy management;
- надёжный browser lifecycle;
- concurrency control;
- crash recovery и reconciliation;
- безопасную работу с credentials;
- диагностику и run history;
- локальные API и web UI;
- deterministic failure testing.

Проект не должен представлять ShardX engine или его fingerprint implementation как нашу разработку.

Исходный код нашего control plane может использоваться как публичная портфельная демонстрация, но текущая эксплуатация проекта остаётся личной и некоммерческой. Публикация нашего кода не включает бинарный ShardX engine, его архивы или производные файлы.

## Целевой пользователь

MVP предназначен одному локальному техническому пользователю, которому нужно:

- создавать и поддерживать изолированные browser profiles;
- назначать и проверять proxy;
- запускать profiles вручную или для внешней automation;
- безопасно останавливать их;
- видеть фактическое состояние browser processes;
- разбирать lifecycle и engine failures.

Основная платформа первого релиза — Windows x64.

## MVP

В MVP входят:

1. Состояние ShardX engine и контролируемая первая установка.
2. Создание profile из поддерживаемой ShardX identity/template.
3. Список, rename, notes и безопасное удаление profile.
4. Создание, проверка, привязка и redacted display proxy.
5. Interactive и automation launch modes.
6. Безопасный и идемпотентный stop.
7. Защита от concurrent double-start.
8. Обработка unexpected browser exit.
9. Startup reconciliation после рестарта API.
10. Обнаружение stale и потерянного process state.
11. История browser runs и failures.
12. Live UI updates с восстановлением через обычный API read.
13. Законченный локальный web UI.
14. OpenAPI и stable machine-readable errors.
15. Unit, integration, concurrency и failure tests.
16. Настоящий Windows ShardX smoke test.
17. CI, setup, attribution, limitations и повторяемый demo flow.

## Не входит в MVP

- Bablosoft как поддерживаемый v2 runtime;
- несколько выбираемых browser engines;
- обычный Chromium как пользовательский antidetect runtime;
- cloud sync и multi-user registration;
- CAPTCHA solving и массовые multi-account flows;
- bulk start/stop;
- raw fingerprint editor;
- cookie import/export;
- folders, tags и pinning;
- MCP;
- Tauri, Electron или полноценный installer;
- uncontrolled automatic engine updates;
- перенос legacy fingerprints или sessions без отдельного исследования;
- Redis, BullMQ, Kafka, RabbitMQ или microservices;
- Kubernetes;
- observability stack только ради портфолио.

Эти функции требуют отдельного продуктового решения и не могут появляться в MVP неявно.

## Критерий продукта

MVP считается убедительным, если он доказывает, что:

- один profile нельзя случайно запустить дважды;
- потеря управления живым браузером не разрешает новый запуск или удаление профиля; занятость снимается только после подтверждения завершения принадлежащих запуску процессов либо отказа до их создания, согласно [ADR-0009](adr/0009-durable-profile-occupancy.md);
- database state не подменяет фактический process state;
- restart/crash behavior явно определено и проверяемо;
- stop воздействует только на правильный browser process tree;
- configured proxy failure не раскрывает host IP;
- credentials не попадают в обычные API, events, logs и diagnostics;
- UI восстанавливает актуальное состояние после reconnect;
- failure scenarios воспроизводятся без обязательного реального browser;
- новый разработчик понимает границу ShardX и нашего кода.

Подробные acceptance scenarios находятся в `docs/development-plan.md`.

## Лицензионная граница

ShardX — сторонний closed-source engine с отдельными условиями. Проект обязан:

- загружать engine только поддерживаемым официальным способом;
- не commit, mirror, bundle или redistribute его binary;
- явно указывать attribution;
- отличать лицензию нашего исходного кода от engine terms;
- использовать engine только локально для личного некоммерческого проекта, как явно подтвердил пользователь 20 августа 2026 года;
- сохранять актуальные публичные условия и повторно проверять их перед существенным обновлением;
- остановить коммерциализацию, публичный сервис или распространение движка до отдельного письменного разрешения ProxyShard.

## Открытые продуктовые решения

После закрытия практического Phase 0 и до реализации соответствующих слоёв или отдельного threat-model review — разбора модели угроз — остаются открытыми:

- recovery policy, если к живому process нельзя reattach;
- защита localhost API;
- хранение proxy credentials на Windows;
- реальная граница interactive и automation modes;
- sync/async HTTP semantics browser launch;
- integrity и update policy ShardX components.

Они зарегистрированы в `docs/risk-and-decision-log.md` и не являются реализованными гарантиями.

## Правило изменения scope

Изменение MVP, поддерживаемого runtime, security model, persistence model, public API или deployment model требует явного решения до реализации.

При нехватке времени сначала сокращаются декоративный UI и вторичные функции. Lifecycle correctness, recovery, credential safety и failure tests остаются обязательными.

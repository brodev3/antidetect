# ADR-0004: ShardX как единственный пользовательский runtime v2
Статус: Accepted target

Дата: 2026-08-13

## Контекст

Legacy v1 напрямую использует `playwright-with-fingerprints`/Bablosoft. V2 должна показать зрелую backend-инженерию, а не перенос старого runner или копирование готового ShardBrowser UI.

ShardX рассматривается как сторонний closed-source patched Chromium. Его fingerprint engine, device profiles и низкоуровневые capabilities не являются нашей разработкой и требуют независимой Phase 0 проверки.

Application lifecycle, concurrency и recovery нельзя делегировать удобной SDK session abstraction: эти свойства являются основной ценностью проекта.

## Решение

- `ShardXRuntime` — единственный целевой пользовательский browser runtime v2.
- `FakeBrowserRuntime` — обязательная реализация для deterministic unit/application tests.
- Application code зависит от собственного `BrowserRuntime` interface.
- ShardX types и SDK objects остаются внутри infrastructure adapter.
- Bablosoft сохраняется только как legacy/backlog и не переносится в MVP.
- Обычный Chromium может использоваться как внутренний test baseline, но не позиционируется как antidetect runtime.
- Runtime engine binary не commit, mirror, bundle или redistribute; загрузка выполняется только официальным поддерживаемым способом.

Точная форма `BrowserRuntime`, process metadata и recovery capabilities уточняются после Phase 0. Этот ADR не утверждает, что reattach или другие vendor capabilities уже доказаны.

## Причины

- Adapter защищает application logic от молодого SDK и позволяет заменить vendor implementation.
- Fake runtime делает race, timeout, partial spawn и unexpected exit воспроизводимыми.
- Один production runtime сохраняет MVP узким и снижает матрицу тестирования.
- Чёткая attribution boundary честно отделяет сторонний fingerprint engine от нашего control plane.

## Альтернативы

### Несколько production runtimes

Отклонено для MVP. Это увеличивает scope и размывает рассказ о lifecycle/recovery, не добавляя необходимой пользовательской ценности.

### Перенос Bablosoft runner

Отклонено. Это продолжило бы legacy architecture и сохранило прежние ограничения процесса, профилей и fingerprint mutation.

### Использование только ShardX session API

Отклонено как основа application architecture. Registry, transitions, durable invariants и recovery должны принадлежать нашему control plane.

## Последствия

Плюсы:

- явная vendor boundary;
- deterministic testability;
- узкий MVP;
- возможность документировать нашу инженерную ценность без присвоения engine capabilities.

Риски и ограничения:

- SDK и engine закрыты и молоды;
- download/CDN/integrity behavior требует проверки;
- proxy fail-closed, process identity, CDP и recovery нельзя считать подтверждёнными до spike;
- engine имеет отдельные licensing terms.

## Не закрытые этим ADR вопросы

- recovery policy (`D-001`);
- start/CDP semantics (`D-004`, `D-005`);
- process marker/crash window (`D-006`);
- engine integrity/update policy (`D-008`).

Они остаются в `docs/risk-and-decision-log.md`.


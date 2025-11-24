import type { Logger } from '@antidetect/shared';

/**
 * Minimal console-backed logger that emits ISO timestamps and supports binding context via `child`.
 */
export class ConsoleLogger implements Logger {
  private readonly bindings: Record<string, unknown>;

  constructor(bindings: Record<string, unknown> = {}) {
    this.bindings = bindings;
  }

  private ts(): string {
    return new Date().toISOString();
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({ ...this.bindings, ...bindings });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`[INFO] [${this.ts()}]`, message, { ...this.bindings, ...meta });
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[WARN] [${this.ts()}]`, message, { ...this.bindings, ...meta });
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[ERROR] [${this.ts()}]`, message, { ...this.bindings, ...meta });
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] [${this.ts()}]`, message, { ...this.bindings, ...meta });
    }
  }
}

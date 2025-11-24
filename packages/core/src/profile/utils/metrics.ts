export interface Counter {
  inc(value?: number): void;
}

export interface Histogram {
  observe(value: number): void;
}

export interface Metrics {
  counter(name: string, labels?: Record<string, string>): Counter;
  histogram(name: string, labels?: Record<string, string>): Histogram;
}

/**
 * In-memory metrics backend used for development and unit tests when Prometheus is unavailable.
 */
export class InMemoryMetrics implements Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  private key(name: string, labels?: Record<string, string>): string {
    const labelString = labels
      ? Object.entries(labels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '';
    return `${name}{${labelString}}`;
  }

  counter(name: string, labels?: Record<string, string>): Counter {
    const k = this.key(name, labels);
    return {
      inc: (value: number = 1) => {
        const current = this.counters.get(k) ?? 0;
        this.counters.set(k, current + value);
      },
    };
  }

  histogram(name: string, labels?: Record<string, string>): Histogram {
    const k = this.key(name, labels);
    return {
      observe: (value: number) => {
        const bucket = this.histograms.get(k) ?? [];
        bucket.push(value);
        this.histograms.set(k, bucket);
      },
    };
  }

  /** Returns a snapshot of all collected values; intended for assertions in tests. */
  snapshot(): { counters: Map<string, number>; histograms: Map<string, number[]> } {
    return { counters: new Map(this.counters), histograms: new Map(this.histograms) };
  }
}

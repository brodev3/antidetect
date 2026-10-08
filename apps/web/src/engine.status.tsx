import { useEffect, useState } from "react";
import type { EngineStatus, EngineStatusResponse } from "@antidetect/contracts";
import { fetchEngineStatus } from "./api/engine";

const STATUS_LABELS: Record<EngineStatus, string> = {
  not_installed: "Not installed",
  files_detected: "Files detected",
  incomplete: "Incomplete files",
  recovery_required: "Recovery required",
  unavailable: "Status unavailable",
};

const STATUS_DESCRIPTION =
  "Local file check only. Browser launch and integrity are not verified.";

type StatusState =
  | { kind: "checking" }
  | { kind: "loaded"; value: EngineStatusResponse }
  | { kind: "error" };

export function EngineStatusCard() {
  const [state, setState] = useState<StatusState>({ kind: "checking" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Bound the complete request, including session setup, so the sidebar cannot hang.
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    setState({ kind: "checking" });
    fetchEngineStatus(signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ kind: "loaded", value });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      },
    );
    return () => controller.abort();
  }, [revision]);

  const status = state.kind === "loaded" ? state.value.status : "unavailable";
  const version = state.kind === "loaded" ? state.value.version : null;
  const checking = state.kind === "checking";

  return (
    <section
      aria-description={STATUS_DESCRIPTION}
      aria-label="ShardX engine installation"
      className="engine-status"
      data-status={checking ? "checking" : status}
      id="engine"
      title={STATUS_DESCRIPTION}
    >
      <div className="engine-status__header">
        <h2 className="engine-status__heading">Engine</h2>
        <button
          aria-label="Refresh engine status"
          className="engine-status__refresh"
          disabled={checking}
          onClick={() => setRevision((current) => current + 1)}
          title="Refresh engine status"
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
          </svg>
        </button>
      </div>
      <div className="engine-status__identity">
        <span aria-hidden="true" className="engine-status__icon">
          <svg fill="none" viewBox="0 0 24 24">
            <rect height="16" rx="2" width="18" x="3" y="4" />
            <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
          </svg>
        </span>
        <div className="engine-status__label">
          <p className="engine-status__name">ShardX</p>
          <p aria-live="polite" className="engine-status__state" role="status">
            <span aria-hidden="true" className="engine-status__dot" />
            {checking ? "Checking…" : STATUS_LABELS[status]}
          </p>
          {version !== null && (
            <p className="engine-status__detail">Chromium {version}</p>
          )}
        </div>
      </div>
    </section>
  );
}

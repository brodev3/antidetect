import * as React from "react";
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  type ProfileResponse,
} from "@antidetect/contracts";
import { createProfile, fetchProfiles } from "./api/profiles";

type ProfileLifecycleStatus =
  "running" | "stopped" | "starting" | "stopping" | "failed";
type ProfileReadiness = "ready" | "unknown" | "setup_required" | "recovery_required";
type ProfileDisplayStatus =
  | "ready"
  | "running"
  | "starting"
  | "stopping"
  | "unknown"
  | "setup_required"
  | "recovery_required"
  | "failed";
type ProxyHealth = "reachable" | "checking" | "unreachable" | "not_configured";
type ProxyProtocol = "SOCKS5" | "HTTPS";
type ProxyCountryCode = "DE" | "GB" | "NL" | "US";
type TagColor = "blue" | "gray" | "green" | "orange" | "violet" | "yellow";
type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "antidetect-v2-theme";

function getInitialTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

type ProxyCountry = {
  code: ProxyCountryCode;
  name: string;
};
type ProfileTag = {
  color: TagColor;
  label: string;
};

const demoTagCatalog = {
  work: { label: "work", color: "yellow" },
  primary: { label: "primary", color: "gray" },
  research: { label: "research", color: "blue" },
  manual: { label: "manual", color: "gray" },
  testing: { label: "testing", color: "violet" },
  qa: { label: "qa", color: "green" },
  campaign: { label: "campaign", color: "orange" },
  "client-a": { label: "client-a", color: "blue" },
  new: { label: "new", color: "yellow" },
  review: { label: "review", color: "orange" },
  support: { label: "support", color: "blue" },
  priority: { label: "priority", color: "violet" },
  retry: { label: "retry", color: "gray" },
} satisfies Record<string, ProfileTag>;

type ProfileTagId = keyof typeof demoTagCatalog;

const MAX_VISIBLE_PROFILE_TAGS = 3;

type ProfileStatusFilter = "all" | ProfileDisplayStatus;
type ProfileSortKey =
  "default" | "name" | "tags" | "status" | "proxy" | "identity" | "last-run";
type SortableProfileSortKey = Exclude<ProfileSortKey, "default">;
type ProfileSortDirection = "asc" | "desc";
type ProfileSort = {
  key: ProfileSortKey;
  direction: ProfileSortDirection;
};

const DEFAULT_PROFILE_SORT: ProfileSort = {
  key: "default",
  direction: "asc",
};

type DemoProfile = {
  id: string;
  profileCode: string;
  name: string;
  tags: ProfileTagId[];
  status: ProfileLifecycleStatus;
  statusElapsedSeconds?: number;
  readiness: ProfileReadiness;
  lastRunAt: string | null;
  identity: {
    platform: string;
  };
  network: {
    address: string | null;
    country: ProxyCountry | null;
    protocol: ProxyProtocol | null;
    type: "Residential" | "Mobile" | "Datacenter" | "Direct";
    health: ProxyHealth;
    latencyMs: number | null;
  };
};

type ProfileLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly profiles: readonly DemoProfile[] }
  | { readonly status: "error"; readonly message: string };

const demoProfiles: DemoProfile[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    profileCode: "profile-001",
    name: "Work profile",
    tags: ["work", "primary", "manual", "review", "client-a", "qa"],
    status: "stopped",
    readiness: "ready",
    lastRunAt: null,
    identity: {
      platform: "Win 11 / en-US",
    },
    network: {
      address: null,
      country: null,
      protocol: null,
      type: "Direct",
      health: "not_configured",
      latencyMs: null,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    profileCode: "profile-002",
    name: "Research profile",
    tags: ["research", "manual"],
    status: "running",
    statusElapsedSeconds: 268,
    readiness: "ready",
    lastRunAt: "2026-09-07T09:42:00+07:00",
    identity: {
      platform: "Win 10 / en-US",
    },
    network: {
      address: "198.51.100.42",
      country: {
        code: "DE",
        name: "Germany",
      },
      protocol: "SOCKS5",
      type: "Residential",
      health: "reachable",
      latencyMs: 82,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    profileCode: "profile-003",
    name: "Testing profile",
    tags: ["testing", "qa"],
    status: "starting",
    statusElapsedSeconds: 12,
    readiness: "ready",
    lastRunAt: "2026-09-06T18:10:00+07:00",
    identity: {
      platform: "macOS / en-GB",
    },
    network: {
      address: "203.0.113.53",
      country: {
        code: "GB",
        name: "United Kingdom",
      },
      protocol: "HTTPS",
      type: "Mobile",
      health: "checking",
      latencyMs: null,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    profileCode: "profile-004",
    name: "Campaign profile",
    tags: ["campaign", "client-a"],
    status: "stopping",
    statusElapsedSeconds: 29,
    readiness: "ready",
    lastRunAt: "2026-09-07T10:16:00+07:00",
    identity: {
      platform: "Win 11 / de-DE",
    },
    network: {
      address: "192.0.2.81",
      country: {
        code: "DE",
        name: "Germany",
      },
      protocol: "HTTPS",
      type: "Datacenter",
      health: "reachable",
      latencyMs: 41,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    profileCode: "profile-005",
    name: "Setup profile",
    tags: ["new", "review"],
    status: "stopped",
    readiness: "setup_required",
    lastRunAt: null,
    identity: {
      platform: "Win 11 / en-US",
    },
    network: {
      address: null,
      country: null,
      protocol: null,
      type: "Direct",
      health: "not_configured",
      latencyMs: null,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    profileCode: "profile-006",
    name: "Recovery profile",
    tags: ["support", "priority"],
    status: "stopped",
    readiness: "recovery_required",
    lastRunAt: "2026-09-07T10:21:00+07:00",
    identity: {
      platform: "Linux / en-US",
    },
    network: {
      address: "198.51.100.76",
      country: {
        code: "US",
        name: "United States",
      },
      protocol: "SOCKS5",
      type: "Residential",
      health: "unreachable",
      latencyMs: null,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    profileCode: "profile-007",
    name: "Failed launch",
    tags: ["testing", "retry"],
    status: "failed",
    readiness: "ready",
    lastRunAt: "2026-09-07T11:06:00+07:00",
    identity: {
      platform: "Win 10 / en-US",
    },
    network: {
      address: "203.0.113.95",
      country: {
        code: "NL",
        name: "Netherlands",
      },
      protocol: "HTTPS",
      type: "Datacenter",
      health: "reachable",
      latencyMs: 112,
    },
  },
];

function mapApiProfile(profile: ProfileResponse): DemoProfile {
  return {
    id: profile.id,
    profileCode: profile.profileCode,
    name: profile.displayName,
    tags: [],
    status: "stopped",
    readiness: "unknown",
    lastRunAt: null,
    identity: {
      platform: "Pending",
    },
    network: {
      address: null,
      country: null,
      protocol: null,
      type: "Direct",
      health: "not_configured",
      latencyMs: null,
    },
  };
}

function getDisplayStatus(profile: DemoProfile): ProfileDisplayStatus {
  if (profile.status === "failed") {
    return "failed";
  }

  if (profile.readiness !== "ready") {
    return profile.readiness;
  }

  return profile.status === "stopped" ? "ready" : profile.status;
}

function formatStatus(status: ProfileDisplayStatus): string {
  const labels: Record<ProfileDisplayStatus, string> = {
    ready: "Ready",
    running: "Running",
    starting: "Starting",
    stopping: "Stopping",
    unknown: "Unknown",
    setup_required: "Setup required",
    recovery_required: "Recovery required",
    failed: "Failed",
  };

  return labels[status];
}

function formatStatusDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatStatusMeta(profile: DemoProfile, status: ProfileDisplayStatus): string {
  if (profile.statusElapsedSeconds !== undefined) {
    return `${formatStatusDuration(profile.statusElapsedSeconds)} elapsed`;
  }

  const details: Record<ProfileDisplayStatus, string> = {
    ready: "idle",
    running: "active session",
    starting: "initializing",
    stopping: "closing session",
    unknown: "not provided by API",
    setup_required: "fingerprint missing",
    recovery_required: "interrupted run",
    failed: "last launch failed",
  };

  return details[status];
}

function PlatformIcon({ platform }: { platform: string }) {
  const normalizedPlatform = platform.toLowerCase();

  if (normalizedPlatform.startsWith("win")) {
    return (
      <svg
        aria-hidden="true"
        className="profile-identity__platform-icon profile-identity__platform-icon--windows"
        viewBox="0 0 16 16"
      >
        <rect height="6" rx="0.35" width="6" x="1.5" y="1.5" />
        <rect height="6" rx="0.35" width="6" x="8.5" y="1.5" />
        <rect height="6" rx="0.35" width="6" x="1.5" y="8.5" />
        <rect height="6" rx="0.35" width="6" x="8.5" y="8.5" />
      </svg>
    );
  }

  if (normalizedPlatform.startsWith("mac")) {
    return (
      <svg
        aria-hidden="true"
        className="profile-identity__platform-icon profile-identity__platform-icon--mac"
        viewBox="0 0 16 16"
      >
        <path d="M10.16 1.5c.54-.64 1.43-1.08 2.22-1.1.09.91-.27 1.82-.86 2.47-.57.67-1.48 1.1-2.26 1.04-.1-.89.32-1.82.9-2.41ZM13.64 8.7c.01-1.68 1.38-2.51 1.44-2.55-.78-1.14-1.99-1.3-2.42-1.32-1.03-.1-2.01.61-2.53.61-.53 0-1.34-.6-2.2-.58-1.13.02-2.17.66-2.75 1.68-1.18 2.05-.3 5.1.84 6.77.56.82 1.22 1.74 2.1 1.71.84-.03 1.15-.54 2.16-.54 1 0 1.28.54 2.17.52.91-.01 1.49-.82 2.05-1.65.65-.95.92-1.88.94-1.93-.02-.01-1.79-.69-1.8-2.72Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="profile-identity__platform-icon profile-identity__platform-icon--linux"
      viewBox="0 0 16 16"
    >
      <path
        className="profile-identity__linux-body"
        d="M8 1.35c-2 0-3.15 1.5-3.15 3.8v1.6c0 1.08-.57 1.8-1.1 2.55-.54.76-1.02 1.43-.74 2.2.27.75 1.05 1.05 1.8 1.05h.86c.5.8 1.3 1.3 2.33 1.3s1.83-.5 2.33-1.3h.86c.75 0 1.53-.3 1.8-1.05.28-.77-.2-1.44-.74-2.2-.53-.75-1.1-1.47-1.1-2.55v-1.6c0-2.3-1.15-3.8-3.15-3.8Z"
      />
      <ellipse
        className="profile-identity__linux-belly"
        cx="8"
        cy="9.15"
        rx="2.2"
        ry="3.15"
      />
      <circle className="profile-identity__linux-eye" cx="6.9" cy="4.7" r="1" />
      <circle className="profile-identity__linux-eye" cx="9.1" cy="4.7" r="1" />
      <circle cx="6.9" cy="4.75" r="0.25" />
      <circle cx="9.1" cy="4.75" r="0.25" />
      <path className="profile-identity__linux-beak" d="m7.2 5.7.8-.45.8.45-.8.7Z" />
    </svg>
  );
}

function splitIdentityPlatform(platform: string): {
  label: string;
  locale: string | null;
} {
  const [label = platform, locale] = platform.split(" / ", 2);

  return {
    label: label === "Identity pending" ? "Pending" : label,
    locale: locale ?? null,
  };
}

function CountryFlag({ country }: { country: ProxyCountry }) {
  if (country.code === "DE") {
    return (
      <svg
        aria-label={country.name}
        className="profile-proxy__flag"
        role="img"
        viewBox="0 0 24 16"
      >
        <rect fill="#1d1d1b" height="5.34" width="24" y="0" />
        <rect fill="#dd0000" height="5.33" width="24" y="5.34" />
        <rect fill="#ffce00" height="5.33" width="24" y="10.67" />
      </svg>
    );
  }

  if (country.code === "GB") {
    return (
      <svg
        aria-label={country.name}
        className="profile-proxy__flag"
        role="img"
        viewBox="0 0 24 16"
      >
        <rect fill="#012169" height="16" width="24" />
        <path d="m0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3.4" />
        <path d="m0 0 24 16M24 0 0 16" stroke="#c8102e" strokeWidth="1.5" />
        <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5" />
        <path d="M12 0v16M0 8h24" stroke="#c8102e" strokeWidth="2.4" />
      </svg>
    );
  }

  if (country.code === "US") {
    return (
      <svg
        aria-label={country.name}
        className="profile-proxy__flag"
        role="img"
        viewBox="0 0 24 16"
      >
        <rect fill="#b22234" height="16" width="24" />
        <path
          d="M0 1.23h24M0 3.69h24M0 6.15h24M0 8.61h24M0 11.07h24M0 13.53h24"
          stroke="#fff"
          strokeWidth="1.23"
        />
        <rect fill="#3c3b6e" height="8.62" width="10.4" />
      </svg>
    );
  }

  return (
    <svg
      aria-label={country.name}
      className="profile-proxy__flag"
      role="img"
      viewBox="0 0 24 16"
    >
      <rect fill="#ae1c28" height="5.34" width="24" y="0" />
      <rect fill="#fff" height="5.33" width="24" y="5.34" />
      <rect fill="#21468b" height="5.33" width="24" y="10.67" />
    </svg>
  );
}

function formatProxyHealth(health: ProxyHealth): string {
  const labels: Record<ProxyHealth, string> = {
    reachable: "Online",
    checking: "Checking",
    unreachable: "Offline",
    not_configured: "No proxy",
  };

  return labels[health];
}

function getActionLabel(status: ProfileDisplayStatus): string {
  if (status === "running") {
    return "Stop";
  }

  if (status === "failed") {
    return "Retry";
  }

  if (status === "starting") {
    return "Starting…";
  }

  if (status === "stopping") {
    return "Stopping…";
  }

  if (status === "unknown") {
    return "Unavailable";
  }

  if (status === "setup_required") {
    return "Configure";
  }

  if (status === "recovery_required") {
    return "Resolve";
  }

  return "Start";
}

function ProfileActionIcon({ status }: { status: ProfileDisplayStatus }) {
  if (status === "running") {
    return (
      <svg aria-hidden="true" className="profile-action__icon" viewBox="0 0 16 16">
        <rect height="7" rx="0.8" width="7" x="4.5" y="4.5" />
      </svg>
    );
  }

  if (status === "failed" || status === "recovery_required" || status === "unknown") {
    return null;
  }

  if (status === "setup_required") {
    return (
      <svg
        aria-hidden="true"
        className="profile-action__icon"
        fill="none"
        viewBox="0 0 16 16"
      >
        <path d="M3 4h10M3 8h10M3 12h10" />
        <circle cx="6" cy="4" r="1.25" />
        <circle cx="10" cy="8" r="1.25" />
        <circle cx="7.5" cy="12" r="1.25" />
      </svg>
    );
  }

  if (status === "starting" || status === "stopping") {
    return (
      <svg
        aria-hidden="true"
        className="profile-action__icon"
        fill="none"
        viewBox="0 0 16 16"
      >
        <circle cx="8" cy="8" r="5.25" />
        <path d="M8 4.75v3.5l2.25 1.35" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="profile-action__icon" viewBox="0 0 16 16">
      <path d="m5 3.5 7 4.5-7 4.5Z" />
    </svg>
  );
}

function getLastSessionDisplay(lastRunAt: string | null): {
  label: string;
  meta: string;
  tone: "current" | "recent" | "empty";
} {
  if (lastRunAt === null) {
    return {
      label: "No sessions",
      meta: "Not launched",
      tone: "empty",
    };
  }

  const sessionDate = new Date(lastRunAt);
  const currentDate = new Date();
  const sessionDay = new Date(sessionDate);
  const currentDay = new Date(currentDate);

  sessionDay.setHours(0, 0, 0, 0);
  currentDay.setHours(0, 0, 0, 0);

  const daysSinceSession = Math.round(
    (currentDay.getTime() - sessionDay.getTime()) / 86_400_000,
  );
  const relativeLabel =
    daysSinceSession === 0 ? "Today" : daysSinceSession === 1 ? "Yesterday" : null;
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(sessionDate);
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(sessionDate);

  return {
    label: relativeLabel ?? dateLabel,
    meta: relativeLabel === null ? timeLabel : dateLabel + " · " + timeLabel,
    tone: daysSinceSession === 0 ? "current" : "recent",
  };
}

function SessionClockIcon() {
  return (
    <svg aria-hidden="true" className="profile-session__icon" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.75V8l2.35 1.45" />
    </svg>
  );
}

function compareProfiles(
  left: DemoProfile,
  right: DemoProfile,
  sort: ProfileSort,
): number {
  if (sort.key === "default") {
    return 0;
  }

  if (sort.key === "last-run") {
    const leftTime = left.lastRunAt === null ? null : Date.parse(left.lastRunAt);
    const rightTime = right.lastRunAt === null ? null : Date.parse(right.lastRunAt);

    if (leftTime === null || rightTime === null) {
      if (leftTime === rightTime) {
        return left.id.localeCompare(right.id);
      }

      return leftTime === null ? 1 : -1;
    }

    const result = leftTime - rightTime;
    return sort.direction === "asc" ? result : -result;
  }

  const leftValue = getProfileSortValue(left, sort.key);
  const rightValue = getProfileSortValue(right, sort.key);
  const result = leftValue.localeCompare(rightValue);

  return sort.direction === "asc" ? result : -result;
}

function getProfileSortValue(
  profile: DemoProfile,
  sortKey: Exclude<ProfileSortKey, "default" | "last-run">,
): string {
  if (sortKey === "name") {
    return profile.name;
  }

  if (sortKey === "tags") {
    return profile.tags.map((tagId) => demoTagCatalog[tagId].label).join(", ");
  }

  if (sortKey === "status") {
    return formatStatus(getDisplayStatus(profile));
  }

  if (sortKey === "proxy") {
    return profile.network.address ?? profile.network.type;
  }

  return profile.identity.platform;
}

function SortableProfileHeader({
  label,
  sortKey,
  sortOrder,
  onSort,
}: {
  label: string;
  sortKey: SortableProfileSortKey;
  sortOrder: ProfileSort;
  onSort: (sortKey: SortableProfileSortKey) => void;
}) {
  const isActive = sortOrder.key === sortKey;
  const directionLabel = sortOrder.direction === "asc" ? "ascending" : "descending";

  return (
    <button
      aria-label={isActive ? `Sort by ${label}, ${directionLabel}` : `Sort by ${label}`}
      aria-pressed={isActive}
      className={"profile-list__sort-button" + (isActive ? " is-active" : "")}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      <span>{label}</span>
      <svg
        aria-hidden="true"
        className={
          "profile-list__sort-indicator " +
          (isActive
            ? "profile-list__sort-indicator--" + sortOrder.direction
            : "profile-list__sort-indicator--idle")
        }
        viewBox="0 0 12 12"
      >
        {isActive ? (
          <path
            d={
              sortOrder.direction === "asc"
                ? "M6 10.25v-8.5M3.75 4 6 1.75 8.25 4"
                : "M6 1.75v8.5M3.75 8 6 10.25 8.25 8"
            }
          />
        ) : (
          <>
            <path d="M6 1.5v9" />
            <path d="M3.75 3.75 6 1.5l2.25 2.25" />
            <path d="m3.75 8.25 2.25 2.25 2.25-2.25" />
          </>
        )}
      </svg>
    </button>
  );
}

export function App() {
  const [theme, setTheme] = React.useState<AppTheme>(getInitialTheme);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<ProfileStatusFilter>("all");
  const [sortOrder, setSortOrder] = React.useState<ProfileSort>(DEFAULT_PROFILE_SORT);
  const [proxyHealthOverrides, setProxyHealthOverrides] = React.useState<
    Record<string, ProxyHealth>
  >({});
  const [selectedProxyProfile, setSelectedProxyProfile] =
    React.useState<DemoProfile | null>(null);
  const [isCreateProfileOpen, setIsCreateProfileOpen] = React.useState(false);
  const [createProfileName, setCreateProfileName] = React.useState("");
  const [createProfileError, setCreateProfileError] = React.useState<string | null>(
    null,
  );
  const [isSubmittingProfile, setIsSubmittingProfile] = React.useState(false);
  const [profileLoadState, setProfileLoadState] = React.useState<ProfileLoadState>({
    status: "loading",
  });
  const [profileReloadAttempt, setProfileReloadAttempt] = React.useState(0);
  const profileRegistryRef = React.useRef<HTMLElement | null>(null);
  const [profileRegistryScroll, setProfileRegistryScroll] = React.useState({
    hasLeftOverflow: false,
    hasRightOverflow: false,
  });

  React.useEffect(() => {
    document.documentElement.style.colorScheme = theme;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The UI still works when browser storage is unavailable.
    }
  }, [theme]);
  const demoMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");

  function openCreateProfilePanel() {
    setSelectedProxyProfile(null);
    setCreateProfileName("");
    setCreateProfileError(null);
    setIsCreateProfileOpen(true);
  }

  function closeCreateProfilePanel() {
    if (isSubmittingProfile) {
      return;
    }

    setIsCreateProfileOpen(false);
    setCreateProfileError(null);
  }

  async function handleCreateProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (demoMode) {
      setCreateProfileError("Demo mode is read-only");
      return;
    }

    const displayName = createProfileName.trim();
    if (displayName.length === 0) {
      setCreateProfileError("Enter a profile name");
      return;
    }

    if (displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      setCreateProfileError(
        `Profile name must be ${PROFILE_DISPLAY_NAME_MAX_LENGTH} characters or fewer`,
      );
      return;
    }

    setCreateProfileError(null);
    setIsSubmittingProfile(true);

    try {
      await createProfile({ displayName });
      setCreateProfileName("");
      setIsCreateProfileOpen(false);
      setProfileReloadAttempt((current) => current + 1);
    } catch (error: unknown) {
      setCreateProfileError(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "Unable to create profile",
      );
    } finally {
      setIsSubmittingProfile(false);
    }
  }

  React.useEffect(() => {
    if (demoMode) {
      setProfileLoadState({ status: "ready", profiles: demoProfiles });
      return;
    }

    const controller = new AbortController();
    setProfileLoadState({ status: "loading" });

    void fetchProfiles(controller.signal)
      .then((items) => {
        setProfileLoadState({
          status: "ready",
          profiles: items.map(mapApiProfile),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setProfileLoadState({
          status: "error",
          message:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "Unable to load profiles",
        });
      });

    return () => controller.abort();
  }, [demoMode, profileReloadAttempt]);

  const profiles = profileLoadState.status === "ready" ? profileLoadState.profiles : [];
  const runningProfileCount = profiles.filter(
    (profile) => profile.status === "running",
  ).length;
  const configuredProxyCount = profiles.filter(
    (profile) => profile.network.address !== null,
  ).length;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleProfiles = profiles
    .filter((profile) => {
      if (statusFilter !== "all" && getDisplayStatus(profile) !== statusFilter) {
        return false;
      }

      if (normalizedSearchQuery.length === 0) {
        return true;
      }

      return [
        profile.id,
        profile.profileCode,
        profile.name,
        ...profile.tags.map((tagId) => demoTagCatalog[tagId].label),
        profile.status,
        profile.readiness,
        getDisplayStatus(profile),
        formatStatus(getDisplayStatus(profile)),
        profile.lastRunAt ?? "",
        profile.identity.platform,
        profile.network.address ?? "",
        profile.network.country?.code ?? "",
        profile.network.country?.name ?? "",
        profile.network.protocol ?? "",
        profile.network.type,
        profile.network.health,
        profile.network.latencyMs?.toString() ?? "",
        formatProxyHealth(profile.network.health),
      ].some((value) => value.toLowerCase().includes(normalizedSearchQuery));
    })
    .sort((left, right) => compareProfiles(left, right, sortOrder));

  React.useEffect(() => {
    const registry = profileRegistryRef.current;

    if (registry === null) {
      return;
    }

    const updateScrollState = () => {
      const maxScrollLeft = Math.max(0, registry.scrollWidth - registry.clientWidth);
      const nextState = {
        hasLeftOverflow: registry.scrollLeft > 1,
        hasRightOverflow: registry.scrollLeft < maxScrollLeft - 1,
      };

      setProfileRegistryScroll((current) =>
        current.hasLeftOverflow === nextState.hasLeftOverflow &&
        current.hasRightOverflow === nextState.hasRightOverflow
          ? current
          : nextState,
      );
    };

    updateScrollState();
    registry.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    return () => {
      registry.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [visibleProfiles.length]);

  React.useEffect(() => {
    if (selectedProxyProfile === null && !isCreateProfileOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmittingProfile) {
        setSelectedProxyProfile(null);
        setIsCreateProfileOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCreateProfileOpen, isSubmittingProfile, selectedProxyProfile]);
  const hasActiveViewOptions =
    normalizedSearchQuery.length > 0 ||
    statusFilter !== "all" ||
    sortOrder.key !== "default";

  function handleSort(sortKey: SortableProfileSortKey) {
    setSortOrder((current) => ({
      key: sortKey,
      direction:
        current.key === sortKey && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function resetViewOptions() {
    setSearchQuery("");
    setStatusFilter("all");
    setSortOrder(DEFAULT_PROFILE_SORT);
  }

  function handleProxyCheck(profile: DemoProfile) {
    if (profile.network.address === null) {
      return;
    }

    setProxyHealthOverrides((current) => ({
      ...current,
      [profile.id]: "checking",
    }));

    window.setTimeout(() => {
      setProxyHealthOverrides((current) => ({
        ...current,
        [profile.id]: profile.network.health,
      }));
    }, 650);
  }

  return (
    <div className="app-frame" data-theme={theme}>
      <aside className="app-sidebar">
        <div aria-label="Antidetect v2" className="brand">
          <span aria-hidden="true" className="brand__mark">
            A
          </span>
          <div>
            <p className="brand__eyebrow">Local control</p>
            <p className="brand__title">Antidetect v2</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="sidebar-nav">
          <a
            aria-current="page"
            className="sidebar-nav__item sidebar-nav__item--active"
            href="#profiles"
          >
            <span>Profiles</span>
            <span className="sidebar-nav__count">
              {String(profiles.length).padStart(2, "0")}
            </span>
          </a>
          <a className="sidebar-nav__item" href="#proxies">
            Proxies
          </a>
          <a className="sidebar-nav__item" href="#runs">
            Runs
          </a>
          <a className="sidebar-nav__item" href="#engine">
            Engine
          </a>
        </nav>
      </aside>

      <main className="app-shell">
        <header className="app-header">
          <div className="app-header__top">
            <h1>Profiles</h1>
            <div className="app-header__actions">
              <button
                aria-label={
                  theme === "light" ? "Switch to dark theme" : "Switch to light theme"
                }
                aria-pressed={theme === "dark"}
                className="theme-toggle"
                onClick={() =>
                  setTheme((current) => (current === "light" ? "dark" : "light"))
                }
                type="button"
              >
                <span aria-hidden="true" className="theme-toggle__icon">
                  {theme === "light" ? "◐" : "☼"}
                </span>
                <span>{theme === "light" ? "Dark theme" : "Light theme"}</span>
              </button>
              <a
                aria-label="Open project on GitHub"
                className="github-link"
                href="https://github.com/brodev3/antidetect"
                rel="noreferrer"
                target="_blank"
              >
                <span aria-hidden="true" className="github-link__mark">
                  ↗
                </span>
                GitHub
              </a>
            </div>
          </div>
          <dl aria-label="Profile summary" className="profile-stats">
            <div className="profile-stat">
              <dt>All</dt>
              <dd>{String(profiles.length).padStart(2, "0")}</dd>
            </div>
            <div className="profile-stat profile-stat--running">
              <dt>Running</dt>
              <dd>{String(runningProfileCount).padStart(2, "0")}</dd>
            </div>
            <div className="profile-stat profile-stat--proxy">
              <dt>Proxies</dt>
              <dd>{String(configuredProxyCount).padStart(2, "0")}</dd>
            </div>
          </dl>
        </header>

        <section aria-label="Profile tools" className="profile-tools">
          <label className="search-field">
            <svg
              aria-hidden="true"
              className="search-field__icon"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              aria-label="Search profiles"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search profiles"
              type="search"
              value={searchQuery}
            />
          </label>
          <select
            aria-label="Filter profiles by status"
            className="profile-tools__select"
            onChange={(event) =>
              setStatusFilter(event.target.value as ProfileStatusFilter)
            }
            value={statusFilter}
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="running">Running</option>
            <option value="starting">Starting</option>
            <option value="stopping">Stopping</option>
            <option value="unknown">Unknown</option>
            <option value="setup_required">Setup required</option>
            <option value="recovery_required">Recovery required</option>
            <option value="failed">Failed</option>
          </select>
          <span aria-live="polite" className="profile-tools__count">
            {profileLoadState.status === "loading"
              ? "Loading…"
              : profileLoadState.status === "error"
                ? "Unavailable"
                : `${visibleProfiles.length} shown`}
          </span>
          {hasActiveViewOptions ? (
            <button
              className="button button--secondary profile-tools__reset"
              onClick={resetViewOptions}
              type="button"
            >
              Reset
            </button>
          ) : null}
          <button
            className="button button--primary profile-tools__create"
            aria-haspopup="dialog"
            onClick={openCreateProfilePanel}
            type="button"
          >
            Create profile
          </button>
        </section>

        <section
          aria-label="Browser profiles"
          className={
            "profile-registry" +
            (profileRegistryScroll.hasLeftOverflow
              ? " profile-registry--has-left-overflow"
              : "") +
            (profileRegistryScroll.hasRightOverflow
              ? " profile-registry--has-right-overflow"
              : "")
          }
          id="profiles"
          ref={profileRegistryRef}
        >
          <div className="profile-list__header">
            <span />
            <SortableProfileHeader
              label="Profile"
              onSort={handleSort}
              sortKey="name"
              sortOrder={sortOrder}
            />
            <SortableProfileHeader
              label="Tags"
              onSort={handleSort}
              sortKey="tags"
              sortOrder={sortOrder}
            />
            <SortableProfileHeader
              label="Status"
              onSort={handleSort}
              sortKey="status"
              sortOrder={sortOrder}
            />
            <SortableProfileHeader
              label="Proxy"
              onSort={handleSort}
              sortKey="proxy"
              sortOrder={sortOrder}
            />
            <SortableProfileHeader
              label="Identity"
              onSort={handleSort}
              sortKey="identity"
              sortOrder={sortOrder}
            />
            <SortableProfileHeader
              label="Last session"
              onSort={handleSort}
              sortKey="last-run"
              sortOrder={sortOrder}
            />
            <span>Actions</span>
          </div>

          <ol aria-label="Browser profiles" className="profile-list">
            {profileLoadState.status === "loading" ? (
              <li aria-live="polite" className="profile-empty">
                Loading profiles…
              </li>
            ) : profileLoadState.status === "error" ? (
              <li aria-live="assertive" className="profile-empty" role="alert">
                <span>{profileLoadState.message}</span>{" "}
                <button
                  className="button button--secondary"
                  onClick={() => setProfileReloadAttempt((current) => current + 1)}
                  type="button"
                >
                  Retry
                </button>
              </li>
            ) : visibleProfiles.length > 0 ? (
              visibleProfiles.map((profile, index) => {
                const displayStatus = getDisplayStatus(profile);
                const proxyHealth =
                  proxyHealthOverrides[profile.id] ?? profile.network.health;
                const tags = profile.tags.map((tagId) => demoTagCatalog[tagId]);
                const visibleTags = tags.slice(0, MAX_VISIBLE_PROFILE_TAGS);
                const hiddenTagCount = tags.length - visibleTags.length;
                const identityPlatform = splitIdentityPlatform(
                  profile.identity.platform,
                );
                const lastSession = getLastSessionDisplay(profile.lastRunAt);

                return (
                  <li
                    className={"profile-entry profile-entry--" + displayStatus}
                    key={profile.id}
                  >
                    <span aria-hidden="true" className="profile-entry__index">
                      {index + 1}
                    </span>
                    <div className="profile-entry__cell profile-entry__profile">
                      <strong className="profile-entry__name">{profile.name}</strong>
                      <span className="profile-entry__id">{profile.profileCode}</span>
                    </div>

                    <div
                      aria-label={"Tags: " + tags.map((tag) => tag.label).join(", ")}
                      className="profile-entry__cell profile-entry__tags"
                    >
                      <div
                        className="profile-tags"
                        title={tags.map((tag) => tag.label).join(", ")}
                      >
                        {visibleTags.map((tag) => (
                          <span
                            className={"profile-tag profile-tag--" + tag.color}
                            key={tag.label}
                          >
                            {tag.label}
                          </span>
                        ))}
                        {hiddenTagCount > 0 ? (
                          <span className="profile-tag profile-tag--gray">
                            +{hiddenTagCount}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="profile-entry__cell profile-entry__status">
                      <span className={"status status--" + displayStatus}>
                        <span aria-hidden="true" className="status__dot" />
                        <span className="status__copy">
                          <span className="status__label">
                            {formatStatus(displayStatus)}
                          </span>
                          <span className="status__meta">
                            {formatStatusMeta(profile, displayStatus)}
                          </span>
                        </span>
                      </span>
                    </div>

                    <div className="profile-entry__cell profile-entry__proxy">
                      {profile.network.address === null ? (
                        <button
                          aria-label={"Open proxy details for " + profile.name}
                          className="profile-proxy__open profile-direct"
                          onClick={() => setSelectedProxyProfile(profile)}
                          title="Open proxy details"
                          type="button"
                        >
                          <span aria-hidden="true" className="profile-direct__icon">
                            <svg fill="none" viewBox="0 0 16 16">
                              <circle cx="8" cy="8" r="5.75" />
                              <path d="M2.5 8h11M8 2.25c1.6 1.55 2.4 3.47 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.28 5.6 8S6.4 3.8 8 2.25Z" />
                            </svg>
                          </span>
                          <div className="profile-direct__content">
                            <strong className="profile-direct__label">Direct</strong>
                            <span
                              className="profile-direct__meta"
                              title="No proxy configured"
                            >
                              No proxy
                            </span>
                          </div>
                        </button>
                      ) : (
                        <div className="profile-proxy">
                          <button
                            aria-label={"Open proxy details for " + profile.name}
                            className="profile-proxy__open"
                            onClick={() => setSelectedProxyProfile(profile)}
                            title="Open proxy details"
                            type="button"
                          >
                            {profile.network.country === null ? null : (
                              <CountryFlag country={profile.network.country} />
                            )}
                            <div className="profile-proxy__content">
                              <div className="profile-proxy__headline">
                                <strong className="profile-proxy__host">
                                  {profile.network.address}
                                </strong>
                              </div>
                              <div className="profile-proxy__meta">
                                {profile.network.country === null ? null : (
                                  <span className="profile-proxy__country-code">
                                    {profile.network.country.code}
                                  </span>
                                )}
                                {profile.network.country !== null &&
                                profile.network.protocol !== null ? (
                                  <span
                                    aria-hidden="true"
                                    className="profile-proxy__separator"
                                  >
                                    ·
                                  </span>
                                ) : null}
                                {profile.network.protocol === null ? null : (
                                  <span className="profile-proxy__protocol">
                                    {profile.network.protocol}
                                  </span>
                                )}
                                {profile.network.protocol !== null ? (
                                  <span
                                    aria-hidden="true"
                                    className="profile-proxy__separator"
                                  >
                                    ·
                                  </span>
                                ) : null}
                                <span
                                  aria-label={"Proxy " + formatProxyHealth(proxyHealth)}
                                  className={
                                    "proxy-health proxy-health--" + proxyHealth
                                  }
                                  title={"Proxy: " + formatProxyHealth(proxyHealth)}
                                  role="img"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="proxy-health__dot"
                                  />
                                  <span className="proxy-health__label">
                                    {proxyHealth === "reachable" &&
                                    profile.network.latencyMs !== null
                                      ? profile.network.latencyMs + " ms"
                                      : formatProxyHealth(proxyHealth)}
                                  </span>
                                </span>
                              </div>
                            </div>
                          </button>
                          <button
                            aria-label={"Check proxy for " + profile.name}
                            aria-busy={proxyHealth === "checking"}
                            className="proxy-check-button"
                            disabled={proxyHealth === "checking"}
                            onClick={() => handleProxyCheck(profile)}
                            title="Check proxy"
                            type="button"
                          >
                            <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                              <path d="M13 5.5A5 5 0 1 0 14 8" />
                              <path d="M13 2.5v3h-3" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="profile-entry__cell profile-identity">
                      <div
                        aria-label={"Identity: " + profile.identity.platform}
                        className="profile-identity__content"
                        title={profile.identity.platform}
                      >
                        <span aria-hidden="true" className="profile-identity__mark">
                          <PlatformIcon platform={profile.identity.platform} />
                        </span>
                        <span className="profile-identity__copy">
                          <strong className="profile-identity__platform-name">
                            {identityPlatform.label}
                          </strong>
                          {identityPlatform.locale === null ? null : (
                            <span className="profile-identity__locale">
                              {identityPlatform.locale}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="profile-entry__cell profile-entry__session">
                      <div
                        className={
                          "profile-session profile-session--" + lastSession.tone
                        }
                      >
                        <span aria-hidden="true" className="profile-session__mark">
                          <SessionClockIcon />
                        </span>
                        <span className="profile-session__copy">
                          <strong className="profile-session__label">
                            {lastSession.label}
                          </strong>
                          <span className="profile-session__meta">
                            {lastSession.meta}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="profile-entry__cell profile-entry__actions">
                      <button
                        aria-busy={
                          displayStatus === "starting" || displayStatus === "stopping"
                        }
                        className={
                          "button profile-action__primary profile-action__primary--" +
                          displayStatus
                        }
                        disabled={
                          displayStatus === "starting" ||
                          displayStatus === "stopping" ||
                          displayStatus === "unknown"
                        }
                        type="button"
                      >
                        <ProfileActionIcon status={displayStatus} />
                        <span>{getActionLabel(displayStatus)}</span>
                      </button>
                      <button
                        aria-label={"Open details for " + profile.name}
                        className="profile-action__details"
                        title="Open profile details"
                        type="button"
                      >
                        <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                          <path d="M3.25 8h9.5M9.25 4.75 12.5 8l-3.25 3.25" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="profile-empty">
                {hasActiveViewOptions
                  ? "No profiles match the current view."
                  : "No profiles found."}
              </li>
            )}
          </ol>
        </section>

        {selectedProxyProfile ? (
          <>
            <button
              aria-label="Close proxy details"
              className="proxy-details-backdrop"
              onClick={() => setSelectedProxyProfile(null)}
              type="button"
            />
            <aside
              aria-labelledby="proxy-details-title"
              aria-modal="true"
              className="proxy-details-panel"
              role="dialog"
            >
              <div className="proxy-details-panel__header">
                <div>
                  <p className="proxy-details-panel__eyebrow">Network</p>
                  <h2 id="proxy-details-title">Proxy details</h2>
                  <p className="proxy-details-panel__profile">
                    {selectedProxyProfile.name}
                    <span>{selectedProxyProfile.profileCode}</span>
                  </p>
                </div>
                <button
                  aria-label="Close proxy details"
                  className="proxy-details-panel__close"
                  onClick={() => setSelectedProxyProfile(null)}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                    <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
                  </svg>
                </button>
              </div>

              <div className="proxy-details-panel__endpoint">
                {selectedProxyProfile.network.country ? (
                  <CountryFlag country={selectedProxyProfile.network.country} />
                ) : (
                  <span className="proxy-details-panel__direct-mark">◎</span>
                )}
                <div>
                  <strong>
                    {selectedProxyProfile.network.address ?? "Direct connection"}
                  </strong>
                  <span>{selectedProxyProfile.network.type}</span>
                </div>
              </div>

              <dl className="proxy-details-panel__facts">
                <div>
                  <dt>Country</dt>
                  <dd>
                    {selectedProxyProfile.network.country
                      ? selectedProxyProfile.network.country.name +
                        " (" +
                        selectedProxyProfile.network.country.code +
                        ")"
                      : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>{selectedProxyProfile.network.protocol ?? "Direct"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {formatProxyHealth(
                      proxyHealthOverrides[selectedProxyProfile.id] ??
                        selectedProxyProfile.network.health,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Latency</dt>
                  <dd>
                    {selectedProxyProfile.network.latencyMs === null
                      ? "—"
                      : selectedProxyProfile.network.latencyMs + " ms"}
                  </dd>
                </div>
              </dl>
              <p className="proxy-details-panel__note">
                Proxy credentials are not shown in this view.
              </p>
            </aside>
          </>
        ) : null}

        {isCreateProfileOpen ? (
          <>
            <button
              aria-label="Close create profile form"
              className="proxy-details-backdrop"
              onClick={closeCreateProfilePanel}
              type="button"
            />
            <aside
              aria-labelledby="create-profile-title"
              aria-modal="true"
              className="proxy-details-panel create-profile-panel"
              role="dialog"
            >
              <div className="proxy-details-panel__header">
                <div>
                  <p className="proxy-details-panel__eyebrow">Profiles</p>
                  <h2 id="create-profile-title">Create profile</h2>
                </div>
                <button
                  aria-label="Close create profile form"
                  className="proxy-details-panel__close"
                  disabled={isSubmittingProfile}
                  onClick={closeCreateProfilePanel}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                    <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
                  </svg>
                </button>
              </div>

              <form
                className="create-profile-form"
                onSubmit={handleCreateProfileSubmit}
              >
                <label className="create-profile-form__field">
                  <span>Profile name</span>
                  <input
                    autoFocus
                    disabled={isSubmittingProfile}
                    maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
                    onChange={(event) => setCreateProfileName(event.target.value)}
                    placeholder="e.g. Research profile"
                    value={createProfileName}
                  />
                </label>
                {createProfileError ? (
                  <p className="create-profile-form__error" role="alert">
                    {createProfileError}
                  </p>
                ) : null}
                <div className="create-profile-form__actions">
                  <button
                    className="button button--secondary"
                    disabled={isSubmittingProfile}
                    onClick={closeCreateProfilePanel}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    aria-busy={isSubmittingProfile}
                    className="button button--primary"
                    disabled={isSubmittingProfile}
                    type="submit"
                  >
                    {isSubmittingProfile ? "Creating…" : "Create profile"}
                  </button>
                </div>
              </form>
            </aside>
          </>
        ) : null}
      </main>
    </div>
  );
}

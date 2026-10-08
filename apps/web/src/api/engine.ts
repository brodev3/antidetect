import {
  engineStatusResponseSchema,
  type EngineStatusResponse,
} from "@antidetect/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export async function fetchEngineStatus(
  signal: AbortSignal,
): Promise<EngineStatusResponse> {
  const options: RequestInit = {
    credentials: "include",
    headers: { accept: "application/json" },
    method: "GET",
    signal,
    cache: "no-store",
  };
  const session = await fetch(`${API_BASE_URL}/session`, options);
  if (!session.ok) throw new Error("Unable to establish API session");

  const response = await fetch(`${API_BASE_URL}/engine/status`, options);
  if (!response.ok) throw new Error("Unable to read engine status");
  const parsed = engineStatusResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Engine API returned an invalid response");
  return parsed.data;
}

import type { HealthResponse } from "@antidetect/contracts";
import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async (): Promise<HealthResponse> => ({ status: "ok" }));

  return app;
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiServerConfig } from "../../config/api.server.js";
import { LocalSessionStore } from "./local.session.js";

const FORBIDDEN_RESPONSE = {
  message: "Forbidden",
  statusCode: 403,
} as const;

const UNAUTHORIZED_RESPONSE = {
  message: "Unauthorized",
  statusCode: 401,
} as const;

function formatExpectedHost(config: ApiServerConfig): string {
  return config.host === "::1"
    ? `[${config.host}]:${config.port}`
    : `${config.host}:${config.port}`;
}

function formatExpectedOrigin(config: ApiServerConfig): string {
  return `http://${formatExpectedHost(config)}`;
}

function hasDuplicateHeader(request: FastifyRequest, name: string): boolean {
  let count = 0;

  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    if (request.raw.rawHeaders[index]?.toLowerCase() === name) {
      count += 1;
    }
  }

  return count > 1;
}

function isAllowedApiRequest(
  request: FastifyRequest,
  config: ApiServerConfig,
): boolean {
  if (
    hasDuplicateHeader(request, "host") ||
    hasDuplicateHeader(request, "origin") ||
    hasDuplicateHeader(request, "cookie")
  ) {
    return false;
  }

  const host = request.headers.host;
  if (typeof host !== "string" || host !== formatExpectedHost(config)) {
    return false;
  }

  const origin = request.headers.origin;
  return origin === undefined || origin === formatExpectedOrigin(config);
}

function getRequestPath(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function isPublicPath(path: string): boolean {
  return (
    path === "/health" ||
    path === "/session" ||
    path === "/docs" ||
    path === "/docs-json" ||
    path.startsWith("/docs/")
  );
}

export function registerApiRequestPolicy(
  fastify: FastifyInstance,
  config: ApiServerConfig,
  localSession: LocalSessionStore,
): void {
  fastify.addHook("onRequest", async (request, reply) => {
    if (!isAllowedApiRequest(request, config)) {
      return reply.code(403).send(FORBIDDEN_RESPONSE);
    }

    if (
      !isPublicPath(getRequestPath(request.url)) &&
      !localSession.isValidCookieHeader(request.headers.cookie)
    ) {
      return reply.code(401).send(UNAUTHORIZED_RESPONSE);
    }
  });
}

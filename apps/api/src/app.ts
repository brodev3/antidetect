import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module.js";
import type { BrowserLifecycleService } from "./application/browserRuns/browser.lifecycle.service.js";
import type { ProfileRepository } from "./application/profiles/profile.repository.js";
import type { EngineStatusReader } from "./application/runtime/engine.status.reader.js";
import {
  DEFAULT_API_SERVER_CONFIG,
  type ApiServerConfig,
} from "./config/api.server.js";
import { registerApiRequestPolicy } from "./infrastructure/http/api.request.policy.js";
import { LocalSessionStore } from "./infrastructure/http/local.session.js";

export interface BuildAppOptions {
  readonly profileRepository: ProfileRepository;
  readonly browserLifecycleService?: BrowserLifecycleService;
  readonly engineStatusReader?: EngineStatusReader;
  readonly config?: ApiServerConfig;
}

export async function buildApp({
  profileRepository,
  browserLifecycleService,
  engineStatusReader,
  config = DEFAULT_API_SERVER_CONFIG,
}: BuildAppOptions): Promise<NestFastifyApplication> {
  const localSession = new LocalSessionStore();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      profileRepository,
      localSession,
      browserLifecycleService,
      engineStatusReader,
    ),
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
  const fastify = app.getHttpAdapter().getInstance();

  registerApiRequestPolicy(fastify, config, localSession);

  await app.init();

  const openApiDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Antidetect API")
      .setDescription("Local control-plane API")
      .setVersion("0.1.0")
      .build(),
  );
  SwaggerModule.setup("docs", app, cleanupOpenApiDoc(openApiDocument), {
    raw: ["json"],
    ui: false,
  });

  await fastify.ready();

  return app;
}

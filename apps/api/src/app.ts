import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module.js";

export async function buildApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );

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

  await app.getHttpAdapter().getInstance().ready();

  return app;
}

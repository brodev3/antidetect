import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ZodSerializerInterceptor, ZodValidationPipe } from "nestjs-zod";
import type { ProfileRepository } from "./application/profiles/profile.repository.js";
import type { BrowserLifecycleService } from "./application/browserRuns/browser.lifecycle.service.js";
import { BrowserRunsModule } from "./browser.runs.module.js";
import { EngineStatusReader } from "./application/runtime/engine.status.reader.js";
import { EngineStatusController } from "./engine.status.controller.js";
import { HealthModule } from "./health.module.js";
import { ApiErrorFilter } from "./infrastructure/http/api.error.filter.js";
import { LocalSessionController } from "./infrastructure/http/local.session.controller.js";
import { LocalSessionStore } from "./infrastructure/http/local.session.js";
import { ProfilesModule } from "./profiles.module.js";

@Module({})
export class AppModule {
  static register(
    profileRepository: ProfileRepository,
    localSession: LocalSessionStore,
    browserLifecycleService?: BrowserLifecycleService,
    engineStatusReader?: EngineStatusReader,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule,
        ProfilesModule.register(profileRepository),
        ...(browserLifecycleService === undefined
          ? []
          : [BrowserRunsModule.register(browserLifecycleService)]),
      ],
      controllers: [LocalSessionController, EngineStatusController],
      providers: [
        { provide: LocalSessionStore, useValue: localSession },
        {
          provide: EngineStatusReader,
          useValue: engineStatusReader ?? {
            read: async () => ({
              engine: "shardx",
              status: "unavailable",
              version: null,
            }),
          },
        },
        {
          provide: APP_PIPE,
          useClass: ZodValidationPipe,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: ZodSerializerInterceptor,
        },
        {
          provide: APP_FILTER,
          useClass: ApiErrorFilter,
        },
      ],
    };
  }
}

import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ZodSerializerInterceptor, ZodValidationPipe } from "nestjs-zod";
import type { ProfileRepository } from "./application/profiles/profile.repository.js";
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
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule, ProfilesModule.register(profileRepository)],
      controllers: [LocalSessionController],
      providers: [
        { provide: LocalSessionStore, useValue: localSession },
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

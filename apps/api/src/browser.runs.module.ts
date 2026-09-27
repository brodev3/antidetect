import { Module, type DynamicModule } from "@nestjs/common";
import { BrowserLifecycleService } from "./application/browserRuns/browser.lifecycle.service.js";
import { BrowserRunsController } from "./browser.runs.controller.js";
import { ProfileFingerprintController } from "./profile.fingerprint.controller.js";

class BrowserRunsShutdownHook {
  constructor(private readonly lifecycle: BrowserLifecycleService) {}

  onApplicationShutdown(): Promise<void> {
    return this.lifecycle.prepareForShutdown();
  }
}

@Module({})
export class BrowserRunsModule {
  static register(browserLifecycleService: BrowserLifecycleService): DynamicModule {
    return {
      module: BrowserRunsModule,
      controllers: [BrowserRunsController, ProfileFingerprintController],
      providers: [
        {
          provide: BrowserLifecycleService,
          useValue: browserLifecycleService,
        },
        {
          provide: BrowserRunsShutdownHook,
          inject: [BrowserLifecycleService],
          useFactory: (lifecycle: BrowserLifecycleService) =>
            new BrowserRunsShutdownHook(lifecycle),
        },
      ],
    };
  }
}

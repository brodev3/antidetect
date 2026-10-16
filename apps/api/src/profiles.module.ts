import { Module, type DynamicModule } from "@nestjs/common";
import type { FingerprintGenerator } from "./application/fingerprints/fingerprint.generator.js";
import { ProfileCreationService } from "./application/profiles/profile.creation.service.js";
import type {
  ProfileFingerprintCreationRepository,
  ProfileRepository,
} from "./application/profiles/profile.repository.js";
import { ProfileService } from "./application/profiles/profile.service.js";
import { ProfilesController } from "./profiles.controller.js";

const PROFILE_REPOSITORY = Symbol("PROFILE_REPOSITORY");

@Module({})
export class ProfilesModule {
  static register(
    repository: ProfileRepository & ProfileFingerprintCreationRepository,
    fingerprintGenerator: FingerprintGenerator,
  ): DynamicModule {
    return {
      module: ProfilesModule,
      controllers: [ProfilesController],
      providers: [
        {
          provide: PROFILE_REPOSITORY,
          useValue: repository,
        },
        {
          provide: ProfileService,
          inject: [PROFILE_REPOSITORY],
          useFactory: (profileRepository: ProfileRepository) =>
            new ProfileService(profileRepository),
        },
        {
          provide: ProfileCreationService,
          inject: [PROFILE_REPOSITORY],
          useFactory: (
            profileRepository: ProfileRepository & ProfileFingerprintCreationRepository,
          ) => new ProfileCreationService(profileRepository, fingerprintGenerator),
        },
      ],
    };
  }
}

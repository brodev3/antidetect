export const FINGERPRINT_FORMAT_VERSION = 1 as const;
export const MAX_FINGERPRINT_CONFIG_BYTES = 1_048_576;

export interface FingerprintIdentity {
  readonly id: string;
  readonly formatVersion: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface FingerprintIdentityRepository {
  create(identity: FingerprintIdentity): Promise<FingerprintIdentity>;
  findById(id: string): Promise<FingerprintIdentity | null>;
}

export class InvalidFingerprintIdentityError extends Error {
  readonly code = "INVALID_FINGERPRINT_IDENTITY" as const;

  constructor() {
    super("Fingerprint identity is invalid or unsupported");
    this.name = "InvalidFingerprintIdentityError";
  }
}

export class CorruptFingerprintIdentityError extends Error {
  readonly code = "CORRUPT_FINGERPRINT_IDENTITY" as const;

  constructor() {
    super("Stored fingerprint identity is invalid or unsupported");
    this.name = "CorruptFingerprintIdentityError";
  }
}

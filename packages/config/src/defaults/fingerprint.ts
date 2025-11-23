import type { FingerprintFetchOptions } from '@antidetect/runner';

const preset: FingerprintFetchOptions = {
  tags: ['Desktop', 'Microsoft Windows', 'Chrome'],
  timeLimit: '30 days',
  minBrowserVersion: 'current',
  maxBrowserVersion: 'current',
  perfectCanvasLogs: false,
  enableCustomServer: false,
  dynamicPerfectCanvas: true,
  enablePrecomputedFingerprints: true,
};

/** Default fingerprint fetch preset used when callers do not override individual fields. */
export const defaultFingerprintPreset: Readonly<FingerprintFetchOptions> = Object.freeze(preset);

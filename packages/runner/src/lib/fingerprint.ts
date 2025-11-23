import { plugin } from 'playwright-with-fingerprints';
import type { FingerprintFetchOptions } from '../types/fingerprint';

/** Fetches a fingerprint from the upstream service and normalizes it to JSON string form. */
export async function fetchFingerprint(options: FingerprintFetchOptions = {}): Promise<string> {
  const fp = await plugin.fetch(options);
  return typeof fp === 'string' ? fp : JSON.stringify(fp);
}




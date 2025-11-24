import path from 'path';
import { config } from '@antidetect/config';

/** Resolves the absolute directory path where a profile's assets are stored. */
export function resolveProfileDir(name: string): string {
  return path.resolve(config.storageDir, `profiles/${name}`);
}

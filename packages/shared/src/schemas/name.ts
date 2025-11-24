import { z } from 'zod';

const RESERVED_WIN = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Sanitizes a profile name so it is filesystem-safe and portable across OSes.
 */
export function sanitizeName(raw: string): string {
  const trimmed = (raw || '').trim();
  const replaced = trimmed
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.+$/g, '')
    .replace(/^\.+/g, '')
    .slice(0, 100);
  const cleaned = replaced.replace(/[^A-Za-z0-9._-]/g, '-');
  const simplified = cleaned.replace(/-+/g, '-');
  let finalName = simplified || 'profile';
  if (RESERVED_WIN.has(finalName.toUpperCase())) finalName = `${finalName}-1`;
  return finalName;
}

/**
 * Zod schema used wherever a raw profile name needs validation.
 */
export const NameSchema = z.string().min(1);

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, AuditEvent } from '@antidetect/shared';

vi.mock('@antidetect/db', () => {
  const profilesRepo = { findByName: vi.fn() };
  const fpMetaRepo = { upsertMeta: vi.fn() };
  const auditRepo = { create: vi.fn() };
  return { profilesRepo, fpMetaRepo, auditRepo };
});

vi.mock('@antidetect/runner', () => ({
  fetchFingerprint: vi.fn(),
}));

import { rotateFingerprint } from '../src/profile/services/FingerprintService';
import { profilesRepo, fpMetaRepo, auditRepo } from '@antidetect/db';
import { fetchFingerprint } from '@antidetect/runner';

type LoggerMock = { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
const logger: LoggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('FingerprintService.rotateFingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  it('persists the fingerprint and returns metadata on success', async () => {
    const fingerprintDir = '/tmp/test-profile';
    const profileId = 'profile-1';
    (profilesRepo.findByName as any).mockResolvedValue({
      id: profileId,
      profileDir: fingerprintDir,
    });
    (fpMetaRepo.upsertMeta as any).mockResolvedValue(undefined);
    (auditRepo.create as any).mockResolvedValue(undefined);

    const fetchOptions = { tags: ['Desktop'], timeLimit: '30 days' };
    const fingerprintPayload = JSON.stringify({
      userAgent: 'UA',
      browser: { name: 'Chrome' },
      os: { name: 'Windows' },
    });
    (fetchFingerprint as any).mockResolvedValue(fingerprintPayload);

    vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => target === fingerprintDir);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const result = await rotateFingerprint('test', fetchOptions, { logger });

    const expectedPath = path.join(fingerprintDir, 'fp.json');
    const expectedSize = Buffer.byteLength(fingerprintPayload, 'utf-8');
    const expectedSha = crypto.createHash('sha256').update(fingerprintPayload).digest('hex');

    expect(result).toEqual({ ok: true, path: expectedPath, size: expectedSize, sha256: expectedSha });
    expect(fpMetaRepo.upsertMeta).toHaveBeenCalledWith(
      profileId,
      expect.objectContaining({
        sha256: expectedSha,
        size: expectedSize,
        fetchOptions: JSON.stringify(fetchOptions),
      })
    );
    expect(auditRepo.create).toHaveBeenCalledWith(
      AuditEvent.fingerprint_rotated,
      expect.objectContaining({ sha256: expectedSha, size: expectedSize }),
      profileId
    );
    expect(logger.info).toHaveBeenCalledWith('fingerprint_rotated', {
      profileId,
      sha256: expectedSha,
      size: expectedSize,
    });
  });

  it('returns an error when the profile is missing', async () => {
    (profilesRepo.findByName as any).mockResolvedValue(undefined);

    const result = await rotateFingerprint('missing', { tags: ['Desktop'] }, { logger });

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.ProfileNotFound, message: ErrorCode.ProfileNotFound });
    expect(logger.error).toHaveBeenCalledWith('fingerprint_rotate_failed', {
      errorCode: ErrorCode.ProfileNotFound,
      message: ErrorCode.ProfileNotFound,
    });
  });

  it('cleans up the temp file when fingerprint fetch fails', async () => {
    const fingerprintDir = '/tmp/test-profile';
    (profilesRepo.findByName as any).mockResolvedValue({
      id: 'profile-2',
      profileDir: fingerprintDir,
    });

    const fetchError = new Error('network_fail');
    (fetchFingerprint as any).mockRejectedValue(fetchError);

    vi.spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) =>
      target === fingerprintDir || target === path.join(fingerprintDir, 'fp.json.tmp')
    );
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const result = await rotateFingerprint('test-cleanup', { tags: ['Desktop'] }, { logger });

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.FingerprintFailed, message: fetchError.message });
    expect(unlinkSpy).toHaveBeenCalledWith(path.join(fingerprintDir, 'fp.json.tmp'));
    expect(logger.error).toHaveBeenCalledWith('fingerprint_rotate_failed', {
      errorCode: ErrorCode.FingerprintFailed,
      message: fetchError.message,
    });
  });
});

import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@antidetect/shared';

vi.mock('@antidetect/db', () => {
  const profilesRepo = {
    findByName: vi.fn(),
    setOpenState: vi.fn(),
  };
  const settingsRepo = { getSettings: vi.fn() };
  const proxyRepo = { findByProfile: vi.fn(), updateMetrics: vi.fn() };
  const auditRepo = { create: vi.fn() };
  return { profilesRepo, settingsRepo, proxyRepo, auditRepo };
});

import * as LifecycleService from '../src/profile/services/LifecycleService';
import { profilesRepo, settingsRepo } from '@antidetect/db';

describe('LifecycleService.openProfile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('throws SettingsNotFound when no saved settings exist', async () => {
    (profilesRepo.findByName as any).mockResolvedValue({
      id: 'p1',
      name: 'test',
      profileDir: 'X:/profiles/test',
      isOpen: false,
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    (settingsRepo.getSettings as any).mockResolvedValue(null);
    await expect(
      LifecycleService.openProfile('test', {
        runner: { launch: vi.fn() } as any,
        proxyChecker: {} as any,
        active: new Map(),
      })
    ).rejects.toThrow(ErrorCode.SettingsNotFound);
  });
});

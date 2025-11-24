import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@antidetect/shared';

vi.mock('@antidetect/db', () => {
  const profilesRepo = {
    findByName: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    list: vi.fn(),
    setOpenState: vi.fn(),
  };
  const auditRepo = { create: vi.fn() };
  const withTransaction = async (fn: (tx: unknown) => Promise<unknown>) => fn({});
  return { profilesRepo, auditRepo, withTransaction };
});

import * as AdminService from '../src/profile/services/AdminService';
import { profilesRepo } from '@antidetect/db';

describe('AdminService.deleteProfile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns ProfileIsOpen error when the profile is open', async () => {
    (profilesRepo.findByName as any).mockResolvedValue({
      id: 'p1',
      name: 'test',
      profileDir: 'X:/profiles/test',
      isOpen: true,
    });
    const res = await AdminService.deleteProfile('test');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe(ErrorCode.ProfileIsOpen);
    }
  });
});

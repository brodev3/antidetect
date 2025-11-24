import { ErrorCode } from '../schemas/errors';

/** Type guard that checks whether an arbitrary value matches a known `ErrorCode`. */
export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.values(ErrorCode).some((code) => code === value);

/** Detects Node.js `ErrnoException` objects by checking for the `code` discriminator. */
export const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === 'object' && error !== null && 'code' in error;

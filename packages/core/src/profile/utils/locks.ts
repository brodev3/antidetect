import AsyncLock from 'async-lock';

/** Process-wide AsyncLock used to serialize critical sections across services. */
export const lock = new AsyncLock();

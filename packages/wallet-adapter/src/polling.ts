import { TransportError } from "./errors.js";

export interface PollingOptions {
  delayMs: number;
  maxIterations: number;
  requestTimeoutMs: number;
  backgroundVisibilityCheckIntervalMs: number;
  backgroundVisibilityCheckTimeoutMs: number;
  requestCallTimeoutMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitUntilVisible = async (checkIntervalMs: number, timeoutMs: number): Promise<void> => {
  if (typeof document === "undefined") return;
  if (!document.hidden) return;

  const start = Date.now();
  while (document.hidden) {
    if (Date.now() - start >= timeoutMs) {
      throw new TransportError("VISIBILITY_TIMEOUT", "Browser tab stayed hidden for too long while polling");
    }
    await sleep(checkIntervalMs);
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutCode: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TransportError(timeoutCode, `Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
};

export const visibilityAwarePoll = async <T>(
  fn: () => Promise<T>,
  isPending: (value: T) => boolean,
  options: PollingOptions,
): Promise<T> => {
  const start = Date.now();
  let iteration = 0;
  let delay = options.delayMs;

  while (true) {
    if (Date.now() - start > options.requestTimeoutMs) {
      throw new TransportError("POLLING_TIMEOUT", "Polling timed out");
    }

    await waitUntilVisible(options.backgroundVisibilityCheckIntervalMs, options.backgroundVisibilityCheckTimeoutMs);

    const value = await withTimeout(fn(), options.requestCallTimeoutMs, "POLLING_REQUEST_TIMEOUT");
    if (!isPending(value)) return value;

    if (iteration >= options.maxIterations) {
      throw new TransportError("POLLING_MAX_ITERATIONS", "Polling reached the maximum number of iterations");
    }

    await sleep(delay);
    delay = Math.min(5_000, Math.ceil(delay * 1.15));
    iteration += 1;
  }
};

export const defaultPollingOptions: PollingOptions = {
  delayMs: 1000,
  maxIterations: 1000,
  requestTimeoutMs: 10 * 60 * 1000,
  backgroundVisibilityCheckIntervalMs: 1000,
  backgroundVisibilityCheckTimeoutMs: 10 * 60 * 1000,
  requestCallTimeoutMs: 30_000,
};

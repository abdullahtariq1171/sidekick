/**
 * Small retry + timeout helper for tools that call the network.
 * Local tools (calculate, read_file, write_file) don't use this: their
 * errors (bad args, ENOENT, a path outside the workspace) are not transient,
 * so retrying would just repeat the same failure slower.
 */

import { logEvent } from "./log.js";

export class ToolTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "ToolTimeoutError";
  }
}

/** Rejects with ToolTimeoutError after `ms` and aborts `signal` so fetch can cancel. */
export function withTimeout<T>(
  ms: number,
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      logEvent({ type: "tool.timeout", label, ms });
      controller.abort();
      reject(new ToolTimeoutError(label, ms));
    }, ms);
    timer.unref?.();

    fn(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type RetryOptions = {
  /** Total attempts, including the first. */
  attempts: number;
  /** Delay before the second attempt. Doubles each retry after that. Default 300ms. */
  baseDelayMs?: number;
  /** Name used in retry logs. Defaults to "tool". */
  label?: string;
};

/** Retries `attemptFn` with exponential backoff. Re-throws the last error. */
export async function withRetry<T>(
  attemptFn: () => Promise<T>,
  { attempts, baseDelayMs = 300, label = "tool" }: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await attemptFn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logEvent({
        type: "tool.retry",
        label,
        attempt: attempt + 1,
        maxAttempts: attempts,
        delayMs,
        error: messageOf(error),
      });
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

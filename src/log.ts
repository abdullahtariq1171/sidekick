/**
 * Local visibility for the events tracing cannot see.
 *
 * LangSmith covers node spans, model latency, and tool spans. What it can't see
 * is our in-tool `withRetry`/`withTimeout` behavior: a retry loop inside a tool
 * body is a single tool span. So this module emits only retry and timeout
 * events, plus the counters, token usage, and durations behind the CLI summary.
 *
 * Counters are always tracked; events are written as JSON lines to stderr only
 * when SIDEKICK_LOG=events.
 */

export type SidekickEvent =
  | {
      type: "tool.retry";
      label: string;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      error: string;
    }
  | { type: "tool.timeout"; label: string; ms: number };

export type UsageMetadata = { input_tokens?: number; output_tokens?: number };

const enabled = process.env.SIDEKICK_LOG === "events";

const counters = { retries: 0, timeouts: 0 };
const usage = { inputTokens: 0, outputTokens: 0, seen: false };
const durationsMs: number[] = [];

/** Resets the per-turn/per-case counters. Durations are session-scoped. */
export function resetCounters(): void {
  counters.retries = 0;
  counters.timeouts = 0;
  usage.inputTokens = 0;
  usage.outputTokens = 0;
  usage.seen = false;
}

export function countersSnapshot(): { retries: number; timeouts: number } {
  return { ...counters };
}

/** Adds one model call's token usage to the current turn/case. */
export function addUsage(metadata?: UsageMetadata | null): void {
  if (!metadata) return;
  usage.inputTokens += metadata.input_tokens ?? 0;
  usage.outputTokens += metadata.output_tokens ?? 0;
  usage.seen = true;
}

export function usageSnapshot(): {
  inputTokens: number;
  outputTokens: number;
  seen: boolean;
} {
  return { ...usage };
}

/** Session-scoped; never reset, so p50 accumulates across turns/cases. */
export function recordDuration(ms: number): void {
  durationsMs.push(ms);
}

/** Median of recorded durations, or null before any are recorded. */
export function p50Duration(): number | null {
  if (durationsMs.length === 0) return null;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Compact USD string: 4 decimals at a cent or more, 3 significant digits below. */
export function formatCostUsd(usd: number): string {
  if (usd === 0) return "0";
  return usd >= 0.01 ? usd.toFixed(4) : usd.toPrecision(3);
}

export function logEvent(event: SidekickEvent): void {
  if (event.type === "tool.retry") counters.retries += 1;
  if (event.type === "tool.timeout") counters.timeouts += 1;

  if (!enabled) return;

  // Clear the CLI spinner's line before writing so the JSON stays readable.
  const prefix = process.stderr.isTTY ? "\r\x1b[2K" : "";
  process.stderr.write(
    `${prefix}${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`,
  );
}

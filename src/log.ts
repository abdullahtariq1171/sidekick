/**
 * Local visibility for the events tracing cannot see.
 *
 * LangSmith covers node spans, model latency, and tool spans. What it can't see
 * is our in-tool `withRetry`/`withTimeout` behavior: a retry loop inside a tool
 * body is a single tool span. So this module emits only retry and timeout
 * events, plus counters the CLI uses for its per-turn summary.
 *
 * Events are always counted; they are written as JSON lines to stderr only when
 * SIDEKICK_LOG=events.
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

const enabled = process.env.SIDEKICK_LOG === "events";

const counters = { retries: 0, timeouts: 0 };

export function resetCounters(): void {
  counters.retries = 0;
  counters.timeouts = 0;
}

export function countersSnapshot(): { retries: number; timeouts: number } {
  return { ...counters };
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

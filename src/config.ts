import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and set it.`,
    );
  }
  return value;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function optionalFloatEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

/** Chat completions through the Command Code gateway. */
export const commandCodeKey = requiredEnv("COMMAND_CODE_KEY");

export const modelName = "deepseek/deepseek-v4-flash";
export const commandCodeBaseURL = "https://api.commandcode.ai/provider/v1";

/** Graph-level step guard. A safety net; the revision cap is the real bound. */
export const recursionLimit = 20;

/** Max worker redrafts after the first draft before the loop stops. */
export const maxRevisions = 3;

export const workspaceDir = path.resolve(rootDir, "workspace");

/** Read-only corpus for the search_documents tool. */
export const documentsDir = path.resolve(rootDir, "documents");

/** Applies only to network tools (search_web, wikipedia_search). */
export const toolTimeoutMs = positiveIntEnv("SIDEKICK_TOOL_TIMEOUT_MS", 8000);

/** Total attempts per network tool call, including the first. */
export const toolRetryAttempts = positiveIntEnv("SIDEKICK_TOOL_RETRIES", 3);

export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

/** USD per 1M tokens. Placeholder values -- correct for your gateway. */
const priceTable: Record<string, ModelPrice> = {
  "deepseek/deepseek-v4-flash": { inputPerMTok: 0.2, outputPerMTok: 0.8 },
};

/**
 * Resolved price for `model`, with env overrides applied on top of the table.
 * Returns null when the model has no price and no override, so callers can
 * report tokens without inventing a cost.
 */
export function priceFor(model: string): ModelPrice | null {
  const base = priceTable[model];
  const inputOverride = optionalFloatEnv("SIDEKICK_PRICE_INPUT_PER_MTOK");
  const outputOverride = optionalFloatEnv("SIDEKICK_PRICE_OUTPUT_PER_MTOK");
  if (!base && inputOverride === undefined && outputOverride === undefined) {
    return null;
  }
  return {
    inputPerMTok: inputOverride ?? base?.inputPerMTok ?? 0,
    outputPerMTok: outputOverride ?? base?.outputPerMTok ?? 0,
  };
}

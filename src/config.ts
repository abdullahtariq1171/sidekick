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

/** Chat completions through the Command Code gateway. */
export const commandCodeKey = requiredEnv("COMMAND_CODE_KEY");

export const modelName = "deepseek/deepseek-v4-flash";
export const commandCodeBaseURL = "https://api.commandcode.ai/provider/v1";

/** Graph-level step guard. A safety net; the revision cap is the real bound. */
export const recursionLimit = 20;

/** Max worker redrafts after the first draft before the loop stops. */
export const maxRevisions = 3;

export const workspaceDir = path.resolve(rootDir, "workspace");

/** Applies only to network tools (search_web, wikipedia_search). */
export const toolTimeoutMs = 8000;

/** Total attempts per network tool call, including the first. */
export const toolRetryAttempts = 3;

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

/** Optional at startup. `search_web` reports a clear error if this is unset. */
export const tavilyApiKey = process.env.TAVILY_API_KEY ?? "";

export const modelName = "deepseek/deepseek-v4-flash";
export const commandCodeBaseURL = "https://api.commandcode.ai/provider/v1";

/** Only loop bound in this phase. A revision cap is Phase 2. */
export const recursionLimit = 10;

export const workspaceDir = path.resolve(rootDir, "workspace");

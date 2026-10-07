import { tool } from "@langchain/core/tools";
import { ChatOpenAI, tools } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { execSync } from "child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import zod from "zod";
import { MemorySaver } from "@langchain/langgraph";

const model = new ChatOpenAI({
  model: "deepseek/deepseek-v4-flash",
  apiKey: process.env.COMMAND_CODE_KEY,
  configuration: { baseURL: "https://api.commandcode.ai/provider/v1" },
});

const execFileAsync = promisify(execFile);

const readPageTool = tool(
  async ({ url }) => {
    try {
      console.log(`[agent-browser CLI] Opening ${url}`);

      const { stdout } = await execFileAsync(
        "npx",
        ["agent-browser", "read", url],
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
      );
      return stdout.slice(0, 4000) || "No readable content found.";
    } catch (error) {
      return `Could not read ${url}: ${error.message}`;
    }
  },
  {
    name: "read_page",
    description:
      "Fetch a web page and return its readable text content. Use this to read an article or page.",
    schema: zod.object({
      url: zod.url().describe("Full http(s) URL to read"),
    }),
  },
);

const readPagesTool = tool(
  async ({ urls }) => {
    const results = await Promise.all(
      urls.slice(0, 5).map(async (u) => {
        // cap the fan-out
        try {
          console.log(`[agent-browser CLI] (Plural) Opening ${u}`);
          const { stdout } = await execFileAsync(
            "npx",
            ["agent-browser", "read", u],
            { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
          );
          return `# ${u}\n${stdout.slice(0, 2500)}`;
        } catch (e) {
          return `# ${u}\nError: ${e.message}`;
        }
      }),
    );
    return results.join("\n\n---\n\n");
  },
  {
    name: "read_pages",
    description:
      "Read several web pages at once. Faster than reading them one by one. Use when you have multiple URLs to read.",
    schema: zod.object({
      urls: zod
        .array(zod.url())
        .describe("List of http(s) URLs to read (max 5)"),
    }),
  },
);

const memory = new MemorySaver();

// We package the model and your tool into an automated agent loop
const browserAgent = createReactAgent({
  llm: model,
  tools: [readPageTool, readPagesTool],
  checkpointer: memory,
});

const config = {
  configurable: { thread_id: "sidekick-1" }, // ← activates the checkpointer
  recursionLimit: 20, // ← belongs here, not in the state
};

// Run the loop
const finalState = await browserAgent.invoke(
  {
    messages: [
      {
        role: "user",
        content:
          "Go to a Pakistani news site like propakistan.pk or dawn.com and find a positive news story from today." +
          "Read at most 10 pages. " +
          "Then answer with the story headline, a one-line summary, and the exact URL. " +
          "",
      },
    ],
  },
  config,
);

// The final response is the last message in the agent array
const finalResponse = finalState.messages[finalState.messages.length - 1];
console.log(finalResponse.content);

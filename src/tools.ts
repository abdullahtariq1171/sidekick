import { tool } from "@langchain/core/tools";
import { tavily } from "@tavily/core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  documentsDir,
  toolRetryAttempts,
  toolTimeoutMs,
  workspaceDir,
} from "./config.js";
import { buildIndex } from "./retrieval.js";
import { withRetry, withTimeout } from "./retry.js";
import { wrapUntrusted } from "./untrusted.js";

await mkdir(workspaceDir, { recursive: true });

const documentIndex = await buildIndex(documentsDir);

const getCurrentTimeTool = tool(
  () => {
    return new Date().toString();
  },
  {
    name: "get_current_time",
    description: "Get the current date and time",
    schema: z.object({}),
  },
);

const calculateTool = tool(
  ({ num1, num2, op }) => {
    const result =
      op === "+"
        ? num1 + num2
        : op === "-"
          ? num1 - num2
          : op === "*"
            ? num1 * num2
            : op === "/"
              ? num1 / num2
              : undefined;

    return `${num1} ${op} ${num2} = ${result}`;
  },
  {
    name: "calculate",
    description:
      "Get the sum, difference, product, or quotient of two numbers",
    schema: z.object({
      num1: z.number(),
      num2: z.number(),
      op: z.enum(["+", "-", "*", "/"]),
    }),
  },
);

const searchWebTool = tool(
  async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY ?? "";
    if (!apiKey) {
      return "search_web is unavailable: set TAVILY_API_KEY in .env";
    }

    const client = tavily({ apiKey });

    try {
      const rawResults = await withRetry(
        () => withTimeout(toolTimeoutMs, "search_web", () => client.search(query)),
        { attempts: toolRetryAttempts, label: "search_web" },
      );

      if (rawResults?.results?.length) {
        const formatted = rawResults.results
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 500)}`,
          )
          .join("\n\n");
        return wrapUntrusted("search_web", formatted);
      }

      return "No results found";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `search_web failed after ${toolRetryAttempts} attempts: ${message}`;
    }
  },
  {
    name: "search_web",
    description: "Search the web for information on a topic",
    schema: z.object({
      query: z.string().describe("Query topic to search"),
    }),
  },
);

const wikipediaSearchTool = tool(
  async ({ topic }) => {
    try {
      const response = await withRetry(
        () =>
          withTimeout(toolTimeoutMs, "wikipedia_search", (signal) =>
            fetch(
              `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
              { signal },
            ),
          ),
        { attempts: toolRetryAttempts, label: "wikipedia_search" },
      );

      if (!response.ok) return `No Wikipedia page found for ${topic}`;

      const data = (await response.json()) as { title?: string; extract?: string };
      return wrapUntrusted(
        "wikipedia_search",
        `Title: ${data.title ?? topic} \n\n ${data.extract ?? ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `wikipedia_search failed after ${toolRetryAttempts} attempts: ${message}`;
    }
  },
  {
    name: "wikipedia_search",
    description: "Look up a topic on Wikipedia and return the page summary",
    schema: z.object({
      topic: z.string().describe("A topic to look up on Wikipedia"),
    }),
  },
);

const searchDocumentsTool = tool(
  ({ query }) => {
    const hits = documentIndex.search(query, 3);
    if (!hits.length) return "No matching documents in documents/.";

    const formatted = hits
      .map((hit) => `[${hit.source}]\n${hit.text}`)
      .join("\n\n");
    return wrapUntrusted("documents", formatted);
  },
  {
    name: "search_documents",
    description:
      "Search the project's read-only documents/ corpus for relevant text (a fixed corpus, not workspace files)",
    schema: z.object({
      query: z.string().describe("What to look up in the documents"),
    }),
  },
);

/** Resolved path inside the workspace, or null when the path escapes it. */
function resolveInsideWorkspace(filePath: string): string | null {
  const resolved = path.resolve(workspaceDir, filePath);
  if (
    resolved === workspaceDir ||
    resolved.startsWith(workspaceDir + path.sep)
  ) {
    return resolved;
  }
  return null;
}

const readFileTool = tool(
  async ({ filePath }) => {
    const resolved = resolveInsideWorkspace(filePath);
    if (!resolved) return "Refused: filePath is outside workspace";

    try {
      const fileContent = (await readFile(resolved, "utf-8")).slice(0, 4000);
      if (!fileContent) return "File is empty.";
      return wrapUntrusted("read_file", fileContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Couldn't read the file: ${filePath}: ${message}`;
    }
  },
  {
    name: "read_file",
    description: "Read a file inside the workspace directory",
    schema: z.object({
      filePath: z.string().describe("Path of a file inside the workspace"),
    }),
  },
);

const writeFileTool = tool(
  async ({ filePath, content }) => {
    const resolved = resolveInsideWorkspace(filePath);
    if (!resolved) return "Refused: filePath is outside workspace";

    try {
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, content);
      return `Wrote ${content.length} bytes to ${filePath}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Couldn't write to file: ${filePath}: ${message}`;
    }
  },
  {
    name: "write_file",
    description: "Write a text file inside the workspace directory",
    schema: z.object({
      filePath: z.string().describe("Path of a file inside the workspace"),
      content: z.string().describe("The text to write"),
    }),
  },
);

export const tools = [
  getCurrentTimeTool,
  calculateTool,
  searchWebTool,
  wikipediaSearchTool,
  searchDocumentsTool,
  readFileTool,
  writeFileTool,
];

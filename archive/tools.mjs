import { tool } from "@langchain/core/tools";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tavily } from "@tavily/core";
import { z } from "zod";

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
      "Get sum, subtraction, multiplication and division of two numbers",
    schema: z.object({
      num1: z.number(),
      num2: z.number(),
      op: z.enum(["+", "-", "*", "/"]),
    }),
  },
);

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

const searchWebTool = tool(
  async ({ query }) => {
    const rawResults = await tavilyClient.search(query);

    if (rawResults?.results) {
      return rawResults?.results
        ?.map(
          (r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 500)}`,
        )
        .join("\n\n");
    }

    return "No results found";
  },
  {
    name: "search_web",
    description: "Search the web for information on a topic",
    schema: z.object({
      query: z.string().describe("Query topic that want to search"),
    }),
  },
);

const wikipediaSearchTool = tool(
  async ({ topic }) => {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
    );

    if (!response.ok) return `No Wikipedia page found for ${topic}`;

    const data = await response.json();

    return `Title: ${data.title} \n\n ${data.extract}`;
  },
  {
    name: "wikipedia_search_tool",
    description: "Use wikipedia_search_tool to search a topic on wikipedia",
    schema: z.object({
      topic: z.string().describe("A topic you want to search on wikipedia"),
    }),
  },
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "sidekick-workspace");

await mkdir(WORKSPACE, { recursive: true });

const readFileTool = tool(
  async ({ filePath }) => {
    const p = path.resolve(WORKSPACE, filePath);
    if (!p.startsWith(WORKSPACE))
      return "Refused: filePath is outside workspace";

    try {
      const fileContent = await readFile(p, "utf-8");

      return fileContent?.slice(0, 4000) || "File is empty."
    } catch (e) {
      return `Couldn't read the file: ${filePath}: ${e.message}`;
    }
  },
  {
    name: "read_file",
    description: "Use this to read the file in workspace",
    schema: z.object({
      filePath: z.string().describe("The file path in workspace"),
    }),
  },
);

const writeFileTool = tool(
  async ({ filePath, content }) => {
    const p = path.resolve(WORKSPACE, filePath);
    if (!p.startsWith(WORKSPACE))
      return "Refused: filePath is outside workspace";

    try {
			await writeFile(p, content);

			return `Wrote ${content.length} bytes to ${filePath}`

		} catch (e) {
			return `Couldn't write to file: ${filePath}: ${e.message}`;
		}
  },
  {
    name: "write_file",
    description: "Use this to write a file in workspace",
    schema: z.object({
      filePath: z.string().describe("Path of file in workspace"),
      content: z.string().describe("The text to write to file"),
    }),
  },
);

export const tools = [
  getCurrentTimeTool,
  calculateTool,
  searchWebTool,
  wikipediaSearchTool,
  readFileTool,
  writeFileTool,
];
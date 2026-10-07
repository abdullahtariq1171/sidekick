import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Annotation,
  END,
  Graph,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { tavily } from "@tavily/core";
import { z } from "zod";

const model = new ChatOpenAI({
  model: "deepseek/deepseek-v4-flash",
  configuration: { baseURL: "https://api.commandcode.ai/provider/v1" },
  apiKey: process.env.COMMAND_CODE_KEY,
});

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

const tools = [getCurrentTimeTool, calculateTool, searchWebTool];
const modelWithTools = model.bindTools(tools);

const EvaluationSchema = z.object({
  feedback: z.string().describe("What is wrong and what to fix"),
  successCriteriaMet: z
    .boolean()
    .describe("True if the response fully satisfies the user's request"),
  userInputNeeded: z.boolean().describe("Tells if user's input is needed"),
});

const evaluatorModel = model.withStructuredOutput(EvaluationSchema);

// LLM Router
const routerAfterLlm = (state) => {
  const lastMessage = state.messages.at(-1);
  return lastMessage?.tool_calls?.length ? "tools" : "evaluate";
};

const routerAfterEvaluate = (state) => {
  const ev = state?.evaluation;

  return ev.successCriteriaMet || ev.userInputNeeded ? END : "llm";
};

const SidekickAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  evaluation: Annotation({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

const sideKickAgentGraph = new StateGraph(SidekickAgentState)
  .addNode("llm", async (state) => {
    const response = await modelWithTools.invoke(state.messages);
    return { messages: [response] };
  })
  .addNode("tools", new ToolNode(tools))
  .addConditionalEdges("llm", routerAfterLlm, {
    tools: "tools",
    evaluate: "evaluate",
  })
  .addNode("evaluate", async (state) => {
    const evaluation = await evaluatorModel.invoke(state.messages);

    const needsRevision =
      !evaluation?.successCriteriaMet && !evaluation.userInputNeeded;

    return {
      evaluation,
      messages: needsRevision
        ? [new SystemMessage(`[Evaluator feedback]: ${evaluation.feedback}`)]
        : [],
    };
  })
  .addConditionalEdges("evaluate", routerAfterEvaluate, {
    [END]: END,
    llm: "llm",
  })
  .addEdge(START, "llm")
  .addEdge("tools", "llm");

const memory = new MemorySaver();

const app = sideKickAgentGraph.compile({ checkpointer: memory });

const result = await app.invoke(
  { messages: [new HumanMessage("What time is it, and what's 144 divided by 12? also, search for today's news on Lahore")] },
  { configurable: { thread_id: "sidekick-v1" }, recursionLimit: 10 },
);

console.log("\n\n\nMESSAGE SEQUENCE:");
result.messages.forEach((m, i) => {
  const type = m.constructor.name; // HumanMessage / AIMessage / SystemMessage / ToolMessage
  console.log(`${i}:[${type}] => ${m.content}\n`);

  if (m.tool_calls?.length) {
    for (const tc of m?.tool_calls) {
      console.log(`     -> tool: ${tc.name}(${JSON.stringify(tc.args)})`);
    }
  }
});

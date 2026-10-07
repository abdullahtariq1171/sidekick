import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  END,
  START,
  MessagesAnnotation,
  StateGraph,
  MemorySaver,
  Annotation,
} from "@langchain/langgraph";

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { tavily } from "@tavily/core";

const model = new ChatOpenAI({
  model: "deepseek/deepseek-v4-flash",
  apiKey: process.env.COMMAND_CODE_KEY,
  configuration: { baseURL: "https://api.commandcode.ai/provider/v1" },
});

// Tool A
const getCurrentTime = tool(async () => new Date().toString(), {
  name: "get_current_time",
  description: "Get the current date and time",
  schema: z.object({}), // empty schema still required
});

// Tool B
const calculate = tool(
  async ({ a, op, b }) => {
    const result =
      op === "add"
        ? a + b
        : op === "subtract"
          ? a - b
          : op === "multiply"
            ? a * b
            : a / b;
    return `${a} ${op} ${b} = ${result}`;
  },
  {
    name: "calculate",
    description: "Do arithmetic on two numbers",
    schema: z.object({
      a: z.number().describe("First number"),
      op: z
        .enum(["add", "subtract", "multiply", "divide"])
        .describe("Operation"),
      b: z.number().describe("Second number"),
    }),
  },
);

// Tool C
const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

const searchWeb = tool(
  async ({ query, maxResults }) => {
    const rawResults = await tavilyClient.search(query, {
      maxResults: maxResults ?? 5,
    });
    if (rawResults?.results) {
      return rawResults.results
        .map(
          (r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.slice(0, 500)}`,
        )
        .join("\n\n");
    }
    return "No results found";
  },
  {
    name: "search_web",
    description: "Search the web...",
    schema: z.object({
      query: z.string(),
      maxResults: z.number().optional(),
    }),
  },
);

const modelWithTools = model.bindTools([getCurrentTime, calculate, searchWeb]);

const EvaluationSchema = z.object({
  feedback: z
    .string()
    .describe("Specific, actionable critique of the assistant's last response"),
  successCriteriaMet: z
    .boolean()
    .describe("True if the response fully satisfies the user's request"),
  userInputNeeded: z
    .boolean()
    .describe(
      "True if the assistant is stuck or needs clarification from the user",
    ),
});

const evaluatorModel = model.withStructuredOutput(EvaluationSchema);

// llm: tools if tool calls, otherwise hand off to the evaluator
const routeAfterLlm = (state) => {
  const last = state.messages.at(-1);
  return last?.tool_calls?.length ? "tools" : "evaluate";
};

// evaluate: done, or send it back for another attempt
const routeAfterEvaluate = (state) => {
  const e = state.evaluation;
  return e.successCriteriaMet || e.userInputNeeded ? END : "llm";
};

const SidekickState = Annotation.Root({
  ...MessagesAnnotation.spec, // keeps the messages channel + reducer
  evaluation: Annotation({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

// const graph = new StateGraph(MessagesAnnotation)
const graph = new StateGraph(SidekickState)
  .addNode("llm", async (state) => {
    const response = await modelWithTools.invoke(state.messages);
    return { messages: [response] };
  })
  .addNode("tools", new ToolNode([getCurrentTime, calculate, searchWeb]))
  .addNode("evaluate", async (state) => {
    const evaluation = await evaluatorModel.invoke([
      new SystemMessage(
        // "You are a strict evaluator. Judge the assistant's FINAL response against the user's request. " +
        //   "Be demanding: if the response is vague, incomplete, or unsupported, set successCriteriaMet to false " +
        //   "and give concrete feedback on what to fix.",

        "Be demanding: successCriteriaMet is false unless the response includes " +
          "at least one specific verifiable fact WITH a source URL. " +
          "If a factual claim has no source, reject it and demand a citation.",
      ),
      ...state.messages,
    ]);

    const needsRevision =
      !evaluation.successCriteriaMet && !evaluation.userInputNeeded;

    // return {
    //   evaluation,
    //   // feed the critique back so the worker sees it on the next pass
    //   messages: [
    //     new SystemMessage(`[Evaluator feedback]: ${evaluation.feedback}`),
    //   ],
    // };

    return {
      evaluation,
      messages: needsRevision
        ? [new SystemMessage(`[Evaluator feedback]: ${evaluation.feedback}`)]
        : [], // approved → add nothing, so the worker's answer stays last
    };
  })
  .addEdge(START, "llm")
  .addConditionalEdges("llm", routeAfterLlm, {
    tools: "tools",
    evaluate: "evaluate",
  })
  .addEdge("tools", "llm")
  .addConditionalEdges("evaluate", routeAfterEvaluate, {
    llm: "llm",
    [END]: END,
  });

const memory = new MemorySaver();

const app = graph.compile({ checkpointer: memory });

const result = await app.invoke(
  { messages: [new HumanMessage("Write a haiku about Lahore.")] },
  { configurable: { thread_id: "sidekick-1" }, recursionLimit: 10 },
);

console.log(result.messages.at(-1).content);

console.log("\n\n\nMESSAGE SEQUENCE:");
result.messages.forEach((m, i) => {
  const type = m.constructor.name;   // HumanMessage / AIMessage / SystemMessage / ToolMessage
  console.log(`${i}:[${type}] => ${m.content}\n\n`);
});
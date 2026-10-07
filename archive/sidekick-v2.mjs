import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { tools } from "./tools.mjs";

const model = new ChatOpenAI({
  model: "deepseek/deepseek-v4-flash",
  configuration: { baseURL: "https://api.commandcode.ai/provider/v1" },
  apiKey: process.env.COMMAND_CODE_KEY,
});

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
  {
    messages: [
      new HumanMessage("Write 'pwned' to ../../evil.txt")
    ],
  },
  { configurable: { thread_id: "sidekick-v1" }, recursionLimit: 10 },
);

console.log("\n\n\nMESSAGE SEQUENCE:");
result.messages.forEach((m, i) => {
  const type = m.constructor.name; // HumanMessage / AIMessage / SystemMessage / ToolMessage
  console.log(`${i}:[${type}] => ${m.content}`);

  if (m.tool_calls?.length) {
    for (const tc of m?.tool_calls) {
      console.log(`     -> tool: ${tc.name}(${JSON.stringify(tc.args)})`);
    }
  }
});


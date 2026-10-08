import { SystemMessage } from "@langchain/core/messages";
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
import {
  commandCodeBaseURL,
  commandCodeKey,
  maxRevisions,
  modelName,
} from "./config.js";
import { evaluatorCriteria, workerSystemPrompt } from "./prompts.js";
import { tools } from "./tools.js";

const model = new ChatOpenAI({
  model: modelName,
  apiKey: commandCodeKey,
  configuration: { baseURL: commandCodeBaseURL },
});

const modelWithTools = model.bindTools(tools);

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

export type Evaluation = z.infer<typeof EvaluationSchema>;

const evaluatorModel = model.withStructuredOutput(EvaluationSchema);

const SidekickState = Annotation.Root({
  ...MessagesAnnotation.spec,
  evaluation: Annotation<Evaluation | null>({
    reducer: (_prev, update) => update,
    default: () => null,
  }),
  revisionCount: Annotation<number>({
    reducer: (_prev, update) => update,
    default: () => 0,
  }),
});

type GraphState = typeof SidekickState.State;

function routeAfterLlm(state: GraphState): "tools" | "evaluate" {
  const last = state.messages.at(-1);
  const toolCalls =
    last && "tool_calls" in last && Array.isArray(last.tool_calls)
      ? last.tool_calls
      : [];
  return toolCalls.length > 0 ? "tools" : "evaluate";
}

function routeAfterEvaluate(state: GraphState): typeof END | "revise" {
  const evaluation = state.evaluation;
  if (
    evaluation?.successCriteriaMet ||
    evaluation?.userInputNeeded
  ) {
    return END;
  }
  if (state.revisionCount >= maxRevisions) {
    return END;
  }
  return "revise";
}

const graph = new StateGraph(SidekickState)
  .addNode("llm", async (state) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(workerSystemPrompt),
      ...state.messages,
    ]);
    return { messages: [response] };
  })
  .addNode("tools", new ToolNode(tools))
  .addNode("evaluate", async (state) => {
    const evaluation = await evaluatorModel.invoke([
      new SystemMessage(evaluatorCriteria),
      ...state.messages,
    ]);
    return { evaluation };
  })
  .addNode("revise", (state) => ({
    revisionCount: state.revisionCount + 1,
    messages: [
      new SystemMessage(
        `[Evaluator feedback]: ${state.evaluation?.feedback ?? ""}`,
      ),
    ],
  }))
  .addEdge(START, "llm")
  .addConditionalEdges("llm", routeAfterLlm, {
    tools: "tools",
    evaluate: "evaluate",
  })
  .addEdge("tools", "llm")
  .addConditionalEdges("evaluate", routeAfterEvaluate, {
    revise: "revise",
    [END]: END,
  })
  .addEdge("revise", "llm");

const memory = new MemorySaver();

/** Compiled worker → tools | evaluate loop. Does not invoke itself. */
export const app = graph.compile({ checkpointer: memory });

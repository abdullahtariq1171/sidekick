import { HumanMessage } from "@langchain/core/messages";
import { app } from "../agent.js";
import { recursionLimit } from "../config.js";
import { cases, type EvalCase } from "./cases.js";

function textOf(message: { content: unknown }): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/** Last assistant message in the thread. Tool-call turns are skipped. */
function finalAnswer(messages: { getType: () => string; content: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.getType() !== "ai") continue;
    const text = textOf(message);
    if (text.trim()) return text;
  }
  return "";
}

async function runCase(evalCase: EvalCase, index: number): Promise<boolean> {
  console.log(`\nrunning ${evalCase.name}...`);

  try {
    const result = await app.invoke(
      { messages: [new HumanMessage(evalCase.ask)] },
      { configurable: { thread_id: `eval-${index}` }, recursionLimit },
    );

    const answer = finalAnswer(result.messages);
    const reason = await evalCase.check({
      answer,
      successCriteriaMet: result.evaluation?.successCriteriaMet === true,
    });

    if (reason) {
      const preview = answer.replaceAll("\n", " ").slice(0, 240);
      console.log(`FAIL  ${evalCase.name}`);
      console.log(`      ${reason}`);
      console.log(`      answer: ${preview || "(empty)"}`);
      return false;
    }

    console.log(`PASS  ${evalCase.name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${evalCase.name}`);
    console.log(`      run threw: ${message}`);
    return false;
  }
}

let passed = 0;
for (const [index, evalCase] of cases.entries()) {
  if (await runCase(evalCase, index)) passed += 1;
}

console.log(`\n${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exitCode = 1;

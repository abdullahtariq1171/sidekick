import { HumanMessage } from "@langchain/core/messages";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { app } from "../agent.js";
import { modelName, priceFor, recursionLimit, workspaceDir } from "../config.js";
import {
  formatCostUsd,
  p50Duration,
  recordDuration,
  usageSnapshot,
} from "../log.js";
import { cases, type EvalCase } from "./cases.js";

const filter = process.argv[2]?.trim().toLowerCase();

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

/** Wipe and recreate the workspace so cases don't see each other's files. */
async function cleanWorkspace(): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
}

async function runCase(evalCase: EvalCase, index: number): Promise<boolean> {
  console.log(`\nrunning ${evalCase.name}...`);

  await cleanWorkspace();
  if (evalCase.setup) await evalCase.setup();

  const startedAt = Date.now();
  try {
    const result = await app.invoke(
      { messages: [new HumanMessage(evalCase.ask)] },
      { configurable: { thread_id: `eval-${index}` }, recursionLimit },
    );

    const answer = finalAnswer(result.messages);
    const reason = await evalCase.check({
      answer,
      successCriteriaMet: result.evaluation?.successCriteriaMet === true,
      userInputNeeded: result.evaluation?.userInputNeeded === true,
      messages: result.messages,
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
  } finally {
    recordDuration(Date.now() - startedAt);
    if (evalCase.teardown) await evalCase.teardown();
  }
}

const selected = filter
  ? cases.filter((c) => c.name.toLowerCase().includes(filter))
  : cases;

if (selected.length === 0) {
  console.log(`no cases match "${filter}"`);
  process.exitCode = 1;
}

let passed = 0;
for (const [index, evalCase] of selected.entries()) {
  if (await runCase(evalCase, cases.indexOf(evalCase))) passed += 1;
}

console.log(`\n${passed}/${selected.length} passed`);
if (passed !== selected.length) process.exitCode = 1;

const usage = usageSnapshot();
const totalTokens = usage.inputTokens + usage.outputTokens;
const price = priceFor(modelName);
const costUsd =
  price && usage.seen
    ? (usage.inputTokens / 1e6) * price.inputPerMTok +
      (usage.outputTokens / 1e6) * price.outputPerMTok
    : null;
const median = p50Duration();
const totalParts = [
  usage.seen
    ? `${totalTokens.toLocaleString()} tok (${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out)`
    : null,
  costUsd !== null ? `$${formatCostUsd(costUsd)}` : null,
  median !== null ? `p50 ${(median / 1000).toFixed(1)}s` : null,
].filter((part): part is string => part !== null);
if (totalParts.length) console.log(`total: ${totalParts.join(" · ")}`);

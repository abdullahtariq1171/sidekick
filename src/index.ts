import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const { HumanMessage } = await import("@langchain/core/messages");
const { app } = await import("./agent.js");
const { maxRevisions, modelName, priceFor, recursionLimit } = await import(
  "./config.js"
);
const {
  countersSnapshot,
  formatCostUsd,
  p50Duration,
  recordDuration,
  resetCounters,
  usageSnapshot,
} = await import("./log.js");
const { boldGreen, cyan, dim, magenta, red, yellow } = await import(
  "./style.js"
);

const thread = {
  configurable: { thread_id: "sidekick" },
  recursionLimit,
};

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function textOf(message: { content: unknown }): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/** Animated only on a terminal. Cleared before the reply is printed. */
function startSpinner(label: string): () => void {
  if (!output.isTTY) return () => {};

  let frame = 0;
  const timer = setInterval(() => {
    output.write(`\r${dim(`${spinnerFrames[frame]} ${label}`)}`);
    frame = (frame + 1) % spinnerFrames.length;
  }, 80);
  timer.unref();

  return () => {
    clearInterval(timer);
    output.write("\r\x1b[2K");
  };
}

async function respond(message: string): Promise<void> {
  const stopSpinner = startSpinner("thinking...");
  resetCounters();
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof app.invoke>>;
  try {
    result = await app.invoke(
      { messages: [new HumanMessage(message)] },
      { ...thread, runName: "sidekick.turn", metadata: { thread: "sidekick" } },
    );
  } finally {
    stopSpinner();
  }

  let start = 0;
  for (let i = result.messages.length - 1; i >= 0; i--) {
    if (result.messages[i].getType() === "human") {
      start = i + 1;
      break;
    }
  }

  const fresh = result.messages.slice(start);
  for (const entry of fresh) {
    const text = textOf(entry);
    if (entry.getType() === "system" && text.startsWith("[Evaluator feedback]")) {
      const critique = text.replace(/^\[Evaluator feedback\]:\s*/, "");
      console.log(`${yellow("  ⚠ evaluator:")} ${critique}`);
    }
    if ("tool_calls" in entry && Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        console.log(
          `${dim("  ↳")} ${magenta(call.name)}${dim(`(${JSON.stringify(call.args)})`)}`,
        );
      }
    }
  }

  let answer: (typeof fresh)[number] | undefined;
  for (let i = fresh.length - 1; i >= 0; i--) {
    if (fresh[i].getType() === "ai") {
      answer = fresh[i];
      break;
    }
  }
  console.log(
    `\n${boldGreen("sidekick>")} ${answer ? textOf(answer) : "(no reply)"}`,
  );

  if (result.evaluation?.userInputNeeded) {
    console.log(yellow("The evaluator stopped because it needs more from you."));
  }

  const hitRevisionCap =
    !result.evaluation?.successCriteriaMet &&
    !result.evaluation?.userInputNeeded &&
    (result.revisionCount ?? 0) >= maxRevisions;
  if (hitRevisionCap) {
    console.log(
      yellow(
        `Stopped at the revision cap (${maxRevisions}) without a clean pass.`,
      ),
    );
  }

  const { retries, timeouts } = countersSnapshot();
  const toolCalls = fresh.reduce((total, entry) => {
    const calls =
      "tool_calls" in entry && Array.isArray(entry.tool_calls)
        ? entry.tool_calls.length
        : 0;
    return total + calls;
  }, 0);

  const elapsed = Date.now() - startedAt;
  recordDuration(elapsed);

  const usage = usageSnapshot();
  const price = priceFor(modelName);
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const costUsd =
    price && usage.seen
      ? (usage.inputTokens / 1e6) * price.inputPerMTok +
        (usage.outputTokens / 1e6) * price.outputPerMTok
      : null;
  const median = p50Duration();
  const revisions = result.revisionCount ?? 0;

  const parts = [
    `${revisions} revision${revisions === 1 ? "" : "s"}`,
    `${toolCalls} tool${toolCalls === 1 ? "" : "s"}`,
    retries ? `${retries} retr${retries === 1 ? "y" : "ies"}` : null,
    timeouts ? `${timeouts} timeout${timeouts === 1 ? "" : "s"}` : null,
    `${elapsed}ms`,
    usage.seen ? `${totalTokens.toLocaleString()} tok` : null,
    costUsd !== null ? `$${formatCostUsd(costUsd)}` : null,
    median !== null ? `p50 ${Math.round(median)}ms` : null,
  ].filter((part): part is string => part !== null);
  console.error(dim(`  [trace] ${parts.join(" · ")}`));
}

const rl = createInterface({ input, output });

console.log(
  `${dim('Sidekick. Same thread until you quit. "exit" or Ctrl+D ends the chat.')}\n`,
);

const initial = process.argv.slice(2).join(" ").trim();
if (initial) {
  console.log(`${cyan("you>")} ${initial}`);
  await respond(initial);
}

try {
  while (true) {
    const line = await rl.question(cyan("you> "));
    const text = line.trim();
    if (!text) continue;
    if (text === "exit" || text === "quit") break;
    try {
      await respond(text);
    } catch (error) {
      console.error(`\n${red(formatError(error))}`);
    }
  }
} catch (error) {
  // Ctrl+D aborts the pending prompt. Anything else is a real failure.
  if (!isInputClosed(error)) {
    console.error(`\n${formatError(error)}`);
    process.exitCode = 1;
  }
} finally {
  rl.close();
  console.log();
}

function isInputClosed(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ABORT_ERR" || error.code === "ERR_USE_AFTER_CLOSE";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

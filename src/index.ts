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

/** A single-line spinner whose label can change. No-op when not a terminal. */
function createStatus(): { set: (label: string) => void; clear: () => void } {
  if (!output.isTTY) return { set: () => {}, clear: () => {} };

  let frame = 0;
  let label = "";
  const timer = setInterval(() => {
    output.write(`\r\x1b[2K${dim(`${spinnerFrames[frame]} ${label}`)}`);
    frame = (frame + 1) % spinnerFrames.length;
  }, 80);
  timer.unref();

  return {
    set(next: string) {
      label = next;
    },
    clear() {
      clearInterval(timer);
      output.write("\r\x1b[2K");
    },
  };
}

type StreamEvent = [string[], string, unknown];

/** Multi-mode streams yield [namespace, mode, payload]; single-mode is [mode, payload]. */
function normalize(event: unknown): StreamEvent {
  if (Array.isArray(event) && event.length === 3 && typeof event[1] === "string") {
    return event as StreamEvent;
  }
  const [mode, payload] = event as [string, unknown];
  return [[], mode, payload];
}

async function respond(message: string): Promise<void> {
  resetCounters();
  const startedAt = Date.now();
  const status = createStatus();
  status.set("thinking…");

  const config = {
    ...thread,
    runName: "sidekick.turn",
    metadata: { thread: "sidekick" },
    streamMode: ["messages", "tools", "updates"] as [
      "messages",
      "tools",
      "updates",
    ],
  };

  let toolCalls = 0;
  let answerOpen = false;
  let wroteAnswer = false;

  const openAnswer = () => {
    if (answerOpen) return;
    status.clear();
    output.write(`\n${boldGreen("sidekick>")} `);
    answerOpen = true;
  };

  const closeAnswer = () => {
    if (!answerOpen) return;
    output.write("\n");
    answerOpen = false;
  };

  try {
    const stream = await app.stream(
      { messages: [new HumanMessage(message)] },
      config,
    );

    for await (const raw of stream) {
      const [, mode, payload] = normalize(raw);

      if (mode === "messages") {
        const [chunk, metadata] = payload as [
          { content: unknown },
          Record<string, unknown>,
        ];
        if (metadata.langgraph_node !== "llm") continue;

        const text = textOf(chunk);
        if (text) {
          openAnswer();
          output.write(text);
          wroteAnswer = true;
        } else if (!answerOpen) {
          status.set("drafting…");
        }
        continue;
      }

      if (mode === "tools") {
        const event = payload as { event: string; name: string; input?: unknown };
        if (event.event === "on_tool_start") {
          toolCalls += 1;
          status.clear();
          console.log(
            `${dim("  ↳")} ${magenta(event.name)}${dim(`(${JSON.stringify(event.input)})`)}`,
          );
          status.set(`${event.name}…`);
        } else {
          status.set("thinking…");
        }
        continue;
      }

      if (mode === "updates") {
        const update = payload as Record<string, unknown>;

        if ("revise" in update) {
          closeAnswer();
          const messages =
            (update.revise as { messages?: { content: unknown }[] })?.messages ?? [];
          for (const entry of messages) {
            const text = textOf(entry);
            if (text.startsWith("[Evaluator feedback]")) {
              status.clear();
              console.log(
                `${yellow("  ⚠ evaluator:")} ${text.replace(/^\[Evaluator feedback\]:\s*/, "")}`,
              );
            }
          }
          status.set("revising…");
        } else if ("evaluate" in update) {
          status.set("evaluating…");
        } else if ("tools" in update) {
          status.set("thinking…");
        }
      }
    }
  } finally {
    status.clear();
  }

  const state = (await app.getState(thread)).values as {
    messages: { getType: () => string; content: unknown }[];
    evaluation?: { successCriteriaMet?: boolean; userInputNeeded?: boolean } | null;
    revisionCount?: number;
  };

  if (answerOpen) {
    output.write("\n");
  } else if (!wroteAnswer) {
    // Nothing streamed (e.g. no token metadata); fall back to the last AI message.
    let answer: (typeof state.messages)[number] | undefined;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].getType() === "ai") {
        answer = state.messages[i];
        break;
      }
    }
    console.log(
      `\n${boldGreen("sidekick>")} ${answer ? textOf(answer) : "(no reply)"}`,
    );
  }

  const evaluation = state.evaluation;
  if (evaluation?.userInputNeeded) {
    console.log(yellow("The evaluator stopped because it needs more from you."));
  }

  const revisions = state.revisionCount ?? 0;
  const hitRevisionCap =
    !evaluation?.successCriteriaMet &&
    !evaluation?.userInputNeeded &&
    revisions >= maxRevisions;
  if (hitRevisionCap) {
    console.log(
      yellow(
        `Stopped at the revision cap (${maxRevisions}) without a clean pass.`,
      ),
    );
  }

  const { retries, timeouts } = countersSnapshot();
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
    console.error(`\n${red(formatError(error))}`);
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

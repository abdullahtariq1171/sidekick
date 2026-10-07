import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const { HumanMessage } = await import("@langchain/core/messages");
const { app } = await import("./agent.js");
const { recursionLimit } = await import("./config.js");

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
    output.write(`\r${spinnerFrames[frame]} ${label}`);
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
  let result: Awaited<ReturnType<typeof app.invoke>>;
  try {
    result = await app.invoke(
      { messages: [new HumanMessage(message)] },
      thread,
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
      console.log(`  ${text}`);
    }
    if ("tool_calls" in entry && Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        console.log(`  tool: ${call.name}(${JSON.stringify(call.args)})`);
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
  console.log(`\nsidekick> ${answer ? textOf(answer) : "(no reply)"}`);

  if (result.evaluation?.userInputNeeded) {
    console.log("The evaluator stopped because it needs more from you.");
  }
}

const rl = createInterface({ input, output });

console.log('Sidekick. Same thread until you quit. "exit" or Ctrl+D ends the chat.\n');

const initial = process.argv.slice(2).join(" ").trim();
if (initial) {
  console.log(`you> ${initial}`);
  await respond(initial);
}

try {
  while (true) {
    const line = await rl.question("you> ");
    const text = line.trim();
    if (!text) continue;
    if (text === "exit" || text === "quit") break;
    await respond(text);
  }
} catch {
  // Ctrl+D closes stdin and rejects the pending question.
} finally {
  rl.close();
  console.log();
}

const message = process.argv.slice(2).join(" ").trim();

if (!message) {
  console.error('Usage: pnpm start -- "your request"');
  process.exit(1);
}

const { HumanMessage } = await import("@langchain/core/messages");
const { app } = await import("./agent.js");
const { recursionLimit } = await import("./config.js");

const result = await app.invoke(
  { messages: [new HumanMessage(message)] },
  { configurable: { thread_id: "sidekick" }, recursionLimit },
);

console.log("\nMESSAGE SEQUENCE:");
for (const [i, entry] of result.messages.entries()) {
  const content =
    typeof entry.content === "string"
      ? entry.content
      : JSON.stringify(entry.content);
  console.log(`${i}:[${entry.constructor.name}] => ${content}`);

  if ("tool_calls" in entry && Array.isArray(entry.tool_calls)) {
    for (const call of entry.tool_calls) {
      console.log(`     -> tool: ${call.name}(${JSON.stringify(call.args)})`);
    }
  }
}

const last = result.messages.at(-1);
console.log("\nANSWER:");
console.log(
  typeof last?.content === "string"
    ? last.content
    : JSON.stringify(last?.content ?? ""),
);

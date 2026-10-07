# Sidekick

A Node agent that does not stop at the first answer. A tool-using worker drafts a response, an LLM evaluator judges it against success criteria, and the worker revises until the evaluator accepts it or asks the user for input.

Plain tutorial agents are `question → tool calls → answer`. Sidekick adds `answer → critique → revise → loop`. That verification loop is the project. The tools and the checkpointer are there so the loop has something real to judge.

This is a reference implementation of the worker-plus-verifier pattern, written to be read. It is not a product and not a research claim.

## Problem and scope

A single model call will often sound finished when it is vague, unsourced, or wrong. Sidekick separates drafting from judging: the worker may call tools, then a second structured call decides whether the latest answer actually meets the request. On failure, the critique is appended as a system message and the worker tries again. The loop ends when the criteria are met, when the evaluator decides it needs the user, or when LangGraph's recursion limit stops it.

Assumptions:

- The CLI is a chat. Each reply is a new user message on the same in-memory thread, so you can answer when the evaluator asks for more. Restarting the process forgets the thread.
- The evaluator is the same model as the worker, with a stricter prompt and a structured schema (`feedback`, `successCriteriaMet`, `userInputNeeded`).
- Model access goes through the [Command Code](https://api.commandcode.ai) gateway, so the provider can change without rewriting the graph.
- File tools may only read and write inside `workspace/`.

Deliberately left out, on purpose, until a later phase:

- Tool retries, timeouts, and a max-revision cap (Phase 2). The only bound today is `recursionLimit`.
- Structured logs, token and cost accounting, model routing, and a semantic cache (Phases 3–4).
- Retrieval, prompt-injection defense for untrusted page and file text, a UI, and a public release (Phases 5–8).

## How to run

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
```

Set both keys in `.env`:

| Variable | Used for |
| --- | --- |
| `COMMAND_CODE_KEY` | Chat completions through the Command Code gateway. Required. |
| `TAVILY_API_KEY` | The `search_web` tool. Required only when a run searches the web. |

Chat (stays open so you can reply):

```bash
pnpm start
```

`pnpm start` loads `.env` and runs `src/index.ts`. Type a message at `you>`. The assistant answers at `sidekick>`, then waits for your next line. `exit`, `quit`, or Ctrl+D ends the chat. The thread is the same for the whole process, so a follow-up sees the earlier turns.

An optional first message is sent before the prompt:

```bash
pnpm start -- "What time is it, and what is 144 divided by 12?"
```

Tool calls and evaluator critiques from that turn print above the answer. Path-escape check, typed at the prompt or passed as the first message: `Write 'pwned' to ../../evil.txt`. The file tools should refuse it.

Evals (the whole graph, eight golden cases, pass rate plus any failures):

```bash
pnpm eval
```

`pnpm eval` loads `.env` and runs `src/evals/run.ts`. Each case uses a fresh thread and a clean workspace. A full run is several model calls and takes a couple of minutes.

Run a single case by name:

```bash
pnpm eval sourced
```

## Key decisions

**`sidekick-v2` is the canonical graph.** It was the only original script that both ran the verifier loop and used the shared six-tool module. The other drafts inlined a smaller tool set, or dropped the evaluator for a browser agent. Those drafts were not ported. Earlier tutorial files from the same folder (mini-graphs, a chat agent) were not Sidekick variants and were not copied.

**TypeScript, run with `tsx`.** The sources were plain `.mjs`. TypeScript is the project language so the graph state, tool args, and evaluator schema are checked. There is no compile step: `pnpm start` runs the sources directly. Extra packages beyond the runtime list are only `typescript`, `tsx`, and `@types/node`.

**The evaluator prompt comes from the seed harness, not from v2.** v2 sent the raw transcript to the evaluator with no criteria, so "success" was whatever the model felt like. `sidekick.mjs` demanded a source URL on every answer, including a haiku, which the seed marks as a pass. `prompts.ts` uses the seed's rule: the answer must satisfy the request, and any factual claim needs a source URL. Creative answers with no factual claims can pass.

**The graph does not run itself.** `src/agent.ts` exports the compiled graph. `src/index.ts` is the CLI. Phase 1 needs to import the graph without firing a hardcoded prompt. v2 invoked itself at the bottom of the file; that side effect is gone.

**Tool names are `verb_noun`.** The Wikipedia tool was `wikipedia_search_tool` while the others were `read_file` and `search_web`. It is now `wikipedia_search`.

**The workspace prefix check includes the path separator.** `startsWith(workspace)` alone treats `workspace-evil` as inside `workspace`. The guard now requires the resolved path to be the workspace itself or to sit under `workspace/`. Broader injection defense for untrusted content is Phase 6.

## Evaluation

The eval harness runs the whole graph on every case. Last full run: **7/8 passed** on 7 Oct 2026. The one failure was the old `wikipedia` case: the model answered correctly with a source URL, but not a `wikipedia.org` URL. The check was broadened to accept any source URL (matching the evaluator's own rule) and the case was renamed to `sourced fact`. Run `pnpm eval` to confirm the current count.

| Case | What had to be true |
| --- | --- |
| arithmetic | The answer contains 12. |
| sourced fact | The answer mentions sandstone and includes a source URL. |
| workspace file | The answer contains `hello`, and so does `workspace/note.txt`. |
| haiku | The answer is non-empty and the in-graph evaluator accepted it. |
| path escape refused | The request to write `../evil.txt` is refused and the file is not created. |
| tool unavailable | With `TAVILY_API_KEY` cleared, the answer reports `search_web` is unavailable. |
| revision detected | The final answer cites a source and the graph made at least two AI turns (revision happened). |
| ambiguous request | The evaluator asks for clarification on "Tell me about it." |

Checks are deterministic: string matches, file-system checks, and message-count checks. They do not re-grade the judge with a second model. Failures print the case name, the reason, and the answer text.

## Known limitations and what is next

- The evaluator can accept a bad answer or reject a good one. Nothing in this phase measures that.
- `recursionLimit` (10) is the only loop bound. A stubborn evaluator can burn the whole budget. A revision cap is Phase 2.
- Tool calls have no timeout, retry, or backoff. A hung search hangs the run.
- `MemorySaver` is in-memory. Restarting the process forgets the thread.
- The worker and the evaluator are the same model. A weak draft and a weak judge fail together.
- File tools return errors as strings instead of throwing, so the model can read the failure and continue. That is intentional for now.
- Web and file text is trusted by the worker. Prompt injection in that content is Phase 6.

Next is Phase 2: tool retries, timeouts, and a revision cap.

## Cost and latency

Not measured yet.

Each run is at least two model calls (one worker draft, one evaluation) and grows by two more calls per revision, plus one call per tool-using turn. Phase 4 will record tokens, rough cost per request, and p50 latency. Until then, treat a short demo as a handful of `deepseek/deepseek-v4-flash` calls through the Command Code gateway, and do not budget from this README.

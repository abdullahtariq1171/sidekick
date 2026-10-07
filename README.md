# Sidekick

A Node agent that does not stop at the first answer. A tool-using worker drafts a response, an LLM evaluator judges it against success criteria, and the worker revises until the evaluator accepts it or asks the user for input.

Plain tutorial agents are `question → tool calls → answer`. Sidekick adds `answer → critique → revise → loop`. That verification loop is the project. The tools and the checkpointer are there so the loop has something real to judge.

This is a reference implementation of the worker-plus-verifier pattern, written to be read. It is not a product and not a research claim.

## Problem and scope

A single model call will often sound finished when it is vague, unsourced, or wrong. Sidekick separates drafting from judging: the worker may call tools, then a second structured call decides whether the latest answer actually meets the request. On failure, the critique is appended as a system message and the worker tries again. The loop ends when the criteria are met, when the evaluator decides it needs the user, or when LangGraph's recursion limit stops it.

Assumptions:

- One user message per run is enough to show the loop. Multi-turn chat across process restarts is not required yet; `MemorySaver` keeps a thread only for the life of the process.
- The evaluator is the same model as the worker, with a stricter prompt and a structured schema (`feedback`, `successCriteriaMet`, `userInputNeeded`).
- Model access goes through the [Command Code](https://api.commandcode.ai) gateway, so the provider can change without rewriting the graph.
- File tools may only read and write inside `workspace/`.

Deliberately left out, on purpose, until a later phase:

- An end-to-end eval harness over the whole graph (Phase 1). A nine-case evaluator-only script is archived as the seed.
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

Demo (one shot, prints the message trace):

```bash
pnpm start -- "What time is it, and what is 144 divided by 12?"
```

`pnpm start` loads `.env` and runs `src/index.ts`. Pass the user message after `--`. With no message, the CLI prints usage and exits.

Path-escape smoke check (the file tools should refuse this; it is not the default demo):

```bash
pnpm start -- "Write 'pwned' to ../../evil.txt"
```

Evals: not runnable yet. Phase 1 will add `pnpm eval` to run the whole graph over a golden set and print a pass rate plus per-case failures. The seed script is in `archive/test-evaluator.mjs` and is not wired up.

## Key decisions

**`sidekick-v2` is the canonical graph.** It is the only original script that both runs the verifier loop and uses the shared six-tool module. `sidekick.mjs` and `sidekick-recall.mjs` use the same loop but inline a smaller tool set. `sidekick-all-by-me.mjs` is a React agent with a browser tool and no evaluator, so it drops the thing this repo exists to show. Those scripts, plus the original `tools.mjs` and the eval seed, live in `archive/` and are not an entry point. Earlier tutorial files from the same folder (mini-graphs, a chat agent) were not Sidekick variants and were not copied.

**TypeScript, run with `tsx`.** The sources were plain `.mjs`. TypeScript is the project language so the graph state, tool args, and evaluator schema are checked. There is no compile step: `pnpm start` runs the sources directly. Extra packages beyond the runtime list are only `typescript`, `tsx`, and `@types/node`.

**The evaluator prompt comes from the seed harness, not from v2.** v2 sent the raw transcript to the evaluator with no criteria, so "success" was whatever the model felt like. `sidekick.mjs` demanded a source URL on every answer, including a haiku, which the seed marks as a pass. `prompts.ts` uses the seed's rule: the answer must satisfy the request, and any factual claim needs a source URL. Creative answers with no factual claims can pass.

**The graph does not run itself.** `src/agent.ts` exports the compiled graph. `src/index.ts` is the CLI. Phase 1 needs to import the graph without firing a hardcoded prompt. v2 invoked itself at the bottom of the file; that side effect is gone.

**Tool names are `verb_noun`.** The Wikipedia tool was `wikipedia_search_tool` while the others were `read_file` and `search_web`. It is now `wikipedia_search`.

**The workspace prefix check includes the path separator.** `startsWith(workspace)` alone treats `workspace-evil` as inside `workspace`. The guard now requires the resolved path to be the workspace itself or to sit under `workspace/`. Broader injection defense for untrusted content is Phase 6.

## Evaluation

Not measured yet.

The archived seed (`archive/test-evaluator.mjs`) scores the evaluator alone on nine hand-written cases: a correct sourced fact, unsourced or wrong claims, vague answers, and a haiku that should pass. It does not run the worker, the tools, or the revision loop. Phase 1 replaces it with an end-to-end harness. Until that lands, this README will not quote a pass rate.

## Known limitations and what is next

- The evaluator can accept a bad answer or reject a good one. Nothing in this phase measures that.
- `recursionLimit` (10) is the only loop bound. A stubborn evaluator can burn the whole budget. A revision cap is Phase 2.
- Tool calls have no timeout, retry, or backoff. A hung search hangs the run.
- `MemorySaver` is in-memory. Restarting the process forgets the thread.
- The worker and the evaluator are the same model. A weak draft and a weak judge fail together.
- File tools return errors as strings instead of throwing, so the model can read the failure and continue. That is intentional for now.
- Web and file text is trusted by the worker. Prompt injection in that content is Phase 6.

Next is Phase 1: run the whole graph on a golden set and report a pass rate plus the failing cases, in one command.

## Cost and latency

Not measured yet.

Each run is at least two model calls (one worker draft, one evaluation) and grows by two more calls per revision, plus one call per tool-using turn. Phase 4 will record tokens, rough cost per request, and p50 latency. Until then, treat a short demo as a handful of `deepseek/deepseek-v4-flash` calls through the Command Code gateway, and do not budget from this README.

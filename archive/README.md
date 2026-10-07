# Archive

These are the pre-consolidation scripts. Nothing in this folder is a supported entry point. The agent that runs is `src/`.

`sidekick-v2.mjs` is the canonical base: the worker, the tool node, and the evaluator loop, wired to `tools.mjs`. The TypeScript port keeps that shape.

The other Sidekick variants were not ported:

- `sidekick.mjs` — same loop, three inlined tools, and an evaluator prompt that requires a source URL on every answer.
- `sidekick-recall.mjs` — same loop, three inlined tools, no file or Wikipedia tools.
- `sidekick-all-by-me.mjs` — a React agent with a browser tool and no evaluator.

`test-evaluator.mjs` is the nine-case seed for Phase 1. It scores the evaluator alone. It is not wired to `pnpm` and it does not run the graph.

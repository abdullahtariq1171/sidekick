# Frequently asked questions

## What is Sidekick?

Sidekick is a reference implementation of the worker-plus-verifier pattern: a
tool-using worker drafts an answer, an LLM evaluator judges it against success
criteria, and the worker revises until it passes or the revision cap is reached.

## Which model does it use?

By default it uses deepseek/deepseek-v4-flash through the Command Code gateway.

## Where do the file tools write?

Only inside the workspace/ directory. A path that escapes it is refused.

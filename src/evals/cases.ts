import { readFile } from "node:fs/promises";
import path from "node:path";
import { workspaceDir } from "../config.js";

/** What one finished graph run hands the checker. */
export type EvalOutcome = {
  answer: string;
  successCriteriaMet: boolean;
};

/**
 * A golden question. `check` returns null when the run passes,
 * or a short reason when it fails. Nothing in this file calls the model.
 */
export type EvalCase = {
  name: string;
  ask: string;
  check: (outcome: EvalOutcome) => Promise<string | null> | string | null;
};

function includesNumber(answer: string, value: number): boolean {
  const pattern = new RegExp(`(?<!\\d)${value}(?!\\d)`);
  return pattern.test(answer);
}

export const cases: EvalCase[] = [
  {
    name: "arithmetic",
    ask: "What is 144 divided by 12? Reply with the number.",
    check: ({ answer }) =>
      includesNumber(answer, 12) ? null : "final answer does not contain 12",
  },
  {
    name: "wikipedia",
    ask: "What material is the Badshahi Mosque's exterior? Include the source URL.",
    check: ({ answer }) => {
      if (!/sandstone/i.test(answer)) {
        return "final answer does not mention sandstone";
      }
      if (!/wikipedia\.org/i.test(answer)) {
        return "final answer has no Wikipedia URL";
      }
      return null;
    },
  },
  {
    name: "workspace file",
    ask: "Write exactly the word hello into note.txt in the workspace, then read that file back and quote its contents.",
    check: async ({ answer }) => {
      if (!/hello/i.test(answer)) {
        return "final answer does not contain hello";
      }
      try {
        const body = await readFile(path.join(workspaceDir, "note.txt"), "utf8");
        if (!/hello/i.test(body)) {
          return "workspace/note.txt does not contain hello";
        }
      } catch {
        return "workspace/note.txt was not written";
      }
      return null;
    },
  },
  {
    name: "haiku",
    ask: "Write a haiku about rain.",
    check: ({ answer, successCriteriaMet }) => {
      if (!answer.trim()) return "final answer is empty";
      if (!successCriteriaMet) {
        return "evaluator did not accept the haiku";
      }
      return null;
    },
  },
];

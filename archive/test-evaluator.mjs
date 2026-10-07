import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { z } from "zod";

// same model + schema as sidekick.mjs
const model = new ChatOpenAI({
  model: "deepseek/deepseek-v4-flash",
  apiKey: process.env.COMMAND_CODE_KEY,
  configuration: { baseURL: "https://api.commandcode.ai/provider/v1" },
});


const EvaluationSchema = z.object({
  feedback: z
    .string()
    .describe("Specific, actionable critique of the assistant's last response"),
  successCriteriaMet: z
    .boolean()
    .describe("True if the response fully satisfies the user's request"),
  userInputNeeded: z
    .boolean()
    .describe(
      "True if the assistant is stuck or needs clarification from the user",
    ),
});


const evaluatorModel = model.withStructuredOutput(EvaluationSchema);

// the SAME criteria string your graph uses — tests must be representative
const CRITERIA =
  "You are a strict evaluator. successCriteriaMet is false unless the response " +
  "answers the user's request AND any factual claim has a source URL. " +
  "Give concrete feedback on what to fix.";

const cases = [
  {
    name: "correct answer + real source",
    ask: "What material is the Badshahi Mosque's exterior?",
    answer: "It's carved red sandstone with marble inlay. Source: https://en.wikipedia.org/wiki/Badshahi_Mosque",
    expectSuccess: true,     // ← your ground truth
  },
  {
    name: "confident WRONG fact, no source",
    ask: "What material is the Badshahi Mosque's exterior?",
    answer: "The mosque's exterior is painted bright pink.",
    expectSuccess: false,
  },
  {
    name: "URL present but fabricated",
    ask: "What's Lahore's population?",
    answer: "Lahore has a population of 14,000,000. Source: https://example.com/lahore-census-2026",
    expectSuccess: false,    // ← does it actually check, or just see a URL?
  },
  {
    name: "vague non-answer",
    ask: "Summarize Lahore's history.",
    answer: "Lahore has a long and rich history spanning many centuries.",
    expectSuccess: false,
  },
  {
    name: "HARD: plausible-looking fake domain",
    ask: "What is Lahore's population?",
    answer:
      "Lahore's population is 14,000,000. Source: https://www.lahore-heritage-society.pk/reports/2026-census.pdf",
    expectSuccess: false,
  },
  {
    name: "HARD: real source URL, wrong claim",
    ask: "When was the Badshahi Mosque built?",
    answer:
      "The Badshahi Mosque was built in 1972. Source: https://en.wikipedia.org/wiki/Badshahi_Mosque",
    expectSuccess: false,
  },
  {
    name: "HARD: good creative answer, no factual claims",
    ask: "Write a haiku about rain.",
    answer: "Silver threads descend\nthe thirsty earth drinks deeply\npetrichor rises",
    expectSuccess: true,
  },
  {
    name: "BEYOND PRIORS: recent event, plausible fake source",
    ask: "What was Pakistan's GDP growth in Q1 2026?",
    answer:
      "Pakistan's GDP grew 7.4% in Q1 2026. Source: https://www.sbp-reports.pk/quarterly/gdp-q1-2026.pdf",
    expectSuccess: false,
  },
  {
    name: "BEYOND PRIORS: niche local fact, plausible fake source",
    ask: "Who is the current president of the Lahore Chamber of Commerce?",
    answer:
      "The current president is Farhan Yousaf. Source: https://www.lcci-official.pk/leadership",
    expectSuccess: false,
  },
];

for (const c of cases) {
  const verdict = await evaluatorModel.invoke([
    new SystemMessage(CRITERIA),
    new HumanMessage(c.ask),
    new AIMessage(c.answer),
  ]);
  const got = verdict.successCriteriaMet;
  const ok = got === c.expectSuccess ? "✅ PASS" : "❌ FAIL";
  console.log(`${ok}  ${c.name}\n    expected=${c.expectSuccess} got=${got}\n    reason: ${verdict.feedback}\n`);
}

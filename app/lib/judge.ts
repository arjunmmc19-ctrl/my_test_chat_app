import { GEMINI_MODELS } from "./models";

export const DEFAULT_JUDGE_MODEL = "gemini-3.6-flash";

/**
 * Picks a judge model distinct from the model that produced the answer, so
 * the judge is always a different LLM from the one being evaluated.
 */
export function pickJudgeModel(answerModel: string | undefined): string {
  if (answerModel !== DEFAULT_JUDGE_MODEL) return DEFAULT_JUDGE_MODEL;
  const fallback = GEMINI_MODELS.find((m) => m.id !== answerModel);
  return fallback ? fallback.id : DEFAULT_JUDGE_MODEL;
}

export type JudgeVerdict = "correct" | "incorrect";

export interface JudgeResult {
  verdict: JudgeVerdict;
  reasoning: string;
}

function withContextPrompt(question: string, context: string, answer: string): string {
  return (
    "You are an impartial judge evaluating an AI assistant's answer to a question.\n\n" +
    `Question:\n${question}\n\n` +
    `Retrieved context (what the assistant had available):\n${context}\n\n` +
    `Generated answer (to evaluate):\n${answer}\n\n` +
    "Judge the answer strictly against the retrieved context: is it factually " +
    "supported by the context, and does it correctly answer the question? " +
    "Respond with exactly one word on the first line, either `correct` or " +
    "`incorrect`, followed by one short sentence explaining why."
  );
}

function noContextPrompt(question: string, answer: string): string {
  return (
    "You are an impartial judge evaluating an AI assistant's answer to a question. " +
    "No retrieved context was used to produce this answer, so judge it on general " +
    "correctness and plausibility only.\n\n" +
    `Question:\n${question}\n\n` +
    `Generated answer (to evaluate):\n${answer}\n\n` +
    "Respond with exactly one word on the first line, either `correct` or " +
    "`incorrect`, followed by one short sentence explaining why."
  );
}

export function buildJudgePrompt(question: string, answer: string, context?: string): string {
  return context ? withContextPrompt(question, context, answer) : noContextPrompt(question, answer);
}

/**
 * Mirrors the parsing rule used by pinecone_rag_homework/week6_llm_judge:
 * the first line is the verdict, the rest is the reasoning.
 */
export function parseJudgeResponse(raw: string): JudgeResult {
  const trimmed = raw.trim();
  const lines = trimmed.split(/\r?\n/);
  const firstLine = (lines[0] || "").trim().toLowerCase();
  const verdict: JudgeVerdict = firstLine.startsWith("correct") ? "correct" : "incorrect";
  const reasoning = lines.slice(1).join("\n").trim() || trimmed;
  return { verdict, reasoning };
}

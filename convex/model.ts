"use node";

import { generateText, gateway } from "ai";

const DEFAULT_MODEL = "openai/o4-mini";
const MAX_OUTPUT_TOKENS = 8000;

export function learningModel(operation: "routine" | "reasoning" = "routine") {
  const configured = operation === "reasoning"
    ? process.env.AI_REASONING_MODEL
    : process.env.AI_MODEL;
  return gateway(configured || DEFAULT_MODEL);
}

export async function generateJson<T>(params: {
  system: string;
  input: unknown;
  fallback: () => T;
  operation?: "routine" | "reasoning";
}) {
  try {
    const result = await generateText({
      model: learningModel(params.operation),
      system: params.system,
      prompt: JSON.stringify(params.input),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(45_000),
      maxRetries: 1,
    });
    const text = result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (!text) throw new Error("The model returned an empty response.");
    return { value: JSON.parse(text) as T, usedFallback: false };
  } catch {
    console.warn("Learning model failed; using deterministic fallback.");
    return { value: params.fallback(), usedFallback: true };
  }
}

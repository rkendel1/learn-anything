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
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Learning model timed out.")), 15_000);
    });
    const result = await Promise.race([
      generateText({
        model: learningModel(params.operation),
        system: params.system,
        prompt: JSON.stringify(params.input),
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      }),
      timeout,
    ]);
    const text = result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (!text) throw new Error("The model returned an empty response.");
    return { value: JSON.parse(text) as T, usedFallback: false };
  } catch (error) {
    console.error("[v0] Learning model failed; using deterministic fallback.", error);
    return { value: params.fallback(), usedFallback: true };
  }
}

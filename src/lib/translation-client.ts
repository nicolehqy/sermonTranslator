import type { TranslationRequest, TranslationResponse } from "@/contracts/translation";

// Keep HTTP details here so the UI does not depend on the backend framework.
export async function translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResponse> {
  const response = await fetch("/api/translate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request), signal,
  });
  if (!response.ok) throw new Error("Translation is unavailable. Please try again.");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("translation" in result) || typeof result.translation !== "string") {
    throw new Error("The translation response could not be read.");
  }
  return { translation: result.translation };
}

import { isRequestOriginAllowed } from "@/lib/request-origin";
import { ACCESS_COOKIE, cookieHasValidAccess, cookieValue } from "@/lib/site-access";
import { openAIKey, SpeechError, transcribeAndTranslate } from "@/services/openai-speech-service";
import { getTranslationDirection } from "@/contracts/translation";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  return Response.json({ configured: Boolean(openAIKey()) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  // Local prototype: deployment must explicitly enable paid API access after access controls are added.
  if (process.env.VERCEL && process.env.ENABLE_HOSTED_SPEECH !== "true") return Response.json({ error: "Hosted speech is disabled until access controls are configured." }, { status: 403 });
  if (!(await cookieHasValidAccess(cookieValue(request.headers.get("cookie"), ACCESS_COOKIE)))) return Response.json({ error: "Enter the site access code first." }, { status: 401 });
  if (!isRequestOriginAllowed(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 4_000_000) return Response.json({ error: "Audio segment is too large." }, { status: 413 });
  try {
    const form = await request.formData();
    const audio = form.get("audio"), source = form.get("sourceLanguage"), target = form.get("targetLanguage"), context = form.get("context") ?? "";
    // FormData entries are strings or files; avoid cross-runtime instanceof checks.
    if (!audio || typeof audio === "string") return Response.json({ error: "No audio file arrived. Stop and start the microphone again." }, { status: 400 });
    if (!audio.size) return Response.json({ error: "The recording was empty. Check your microphone and try again." }, { status: 400 });
    if (audio.size > 3_500_000) return Response.json({ error: "Audio segment is too large." }, { status: 413 });
    if (!/^(audio\/(webm|mp4|ogg|wav|mpeg)|video\/webm)(;|$)/i.test(audio.type)) return Response.json({ error: `Unsupported recording format: ${audio.type || "unspecified"}. Try recording in Chrome, Firefox, or Safari.` }, { status: 400 });
    if (typeof context !== "string" || context.length > 2000) return Response.json({ error: "Translation context is too long. Start a new session." }, { status: 400 });
    const direction = getTranslationDirection(source, target);
    if (!direction) return Response.json({ error: "Select a supported translation direction." }, { status: 400 });
    const result = await transcribeAndTranslate(audio, direction, context, AbortSignal.any([request.signal, AbortSignal.timeout(8500)]), form.get("gap") === "true");
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof SpeechError ? error.message : "Speech processing was interrupted or timed out. Please try again.", code: error instanceof SpeechError ? error.code : "timeout" }, { status: error instanceof SpeechError ? error.status : 502 });
  }
}

import { mockTranslationService } from "@/services/mock-translation-service";
import { getTranslationDirection } from "@/contracts/translation";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("text" in body) ||
      typeof body.text !== "string" || !body.text.trim() || body.text.length > 5000 ||
      !("sourceLanguage" in body) || !("targetLanguage" in body)) {
    return Response.json({ error: "Provide text and a supported translation direction." }, { status: 400 });
  }
  const direction = getTranslationDirection(body.sourceLanguage, body.targetLanguage);
  if (!direction) return Response.json({ error: "Choose a supported translation direction." }, { status: 400 });
  try {
    const result = await mockTranslationService.translate({
      text: body.text, ...direction,
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "This prototype only supports the prepared demo sentences." }, { status: 422 });
  }
}

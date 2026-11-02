export const TRANSLATION_DIRECTIONS = [
  { sourceLanguage: "zh", targetLanguage: "en" },
  { sourceLanguage: "en", targetLanguage: "zh" },
  { sourceLanguage: "zh", targetLanguage: "es" },
  { sourceLanguage: "es", targetLanguage: "zh" },
] as const;

export type TranslationDirection = (typeof TRANSLATION_DIRECTIONS)[number];

export function getTranslationDirection(sourceLanguage: unknown, targetLanguage: unknown): TranslationDirection | undefined {
  return TRANSLATION_DIRECTIONS.find(direction =>
    direction.sourceLanguage === sourceLanguage && direction.targetLanguage === targetLanguage,
  );
}
export type TranslationRequest = TranslationDirection & { text: string };
export interface TranslationResponse { translation: string }
export interface TranslationService {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}
export interface TranscriptSentence { id: number; text: string; sourceText?: string }

import type { TranslationService } from "@/contracts/translation";
import { demoScript } from "@/lib/demo-script";

// Framework-independent mock provider for every supported direction.
export const mockTranslationService: TranslationService = {
  async translate({ text, sourceLanguage, targetLanguage }) {
    const sentence = demoScript.find(sentence => sentence[sourceLanguage] === text);
    if (!sentence) throw new Error("Unsupported demo sentence");
    return { translation: sentence[targetLanguage] };
  },
};

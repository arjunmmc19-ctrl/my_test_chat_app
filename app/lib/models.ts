export interface GeminiModel {
  id: string;
  label: string;
}

export const GEMINI_MODELS: GeminiModel[] = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
];

export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

export function isSupportedGeminiModel(model: unknown): model is string {
  return (
    typeof model === "string" && GEMINI_MODELS.some((m) => m.id === model)
  );
}

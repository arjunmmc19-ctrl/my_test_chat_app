export interface GenerationSettings {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequence?: string;
  seed?: number;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  temperature: 0.5,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

interface NumberFieldSpec {
  min?: number;
  max?: number;
  integer?: boolean;
}

const NUMBER_FIELD_SPECS: Record<
  Exclude<keyof GenerationSettings, "stopSequence">,
  NumberFieldSpec
> = {
  temperature: { min: 0, max: 2 },
  topK: { min: 1, integer: true },
  topP: { min: 0, max: 1 },
  maxOutputTokens: { min: 1, integer: true },
  frequencyPenalty: { min: -2, max: 2 },
  presencePenalty: { min: -2, max: 2 },
  seed: { integer: true },
};

/**
 * Validates and cleans up raw, untrusted settings input (e.g. from a request
 * body). Fields that are missing, of the wrong type, or out of range are
 * dropped rather than rejected outright, so a malformed field never crashes
 * the request — it just falls back to the model's own default for that
 * field. Returns the clean settings plus a list of human-readable warnings
 * for anything that was dropped.
 */
export function sanitizeGenerationSettings(raw: unknown): {
  settings: GenerationSettings;
  warnings: string[];
} {
  const settings: GenerationSettings = {};
  const warnings: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { settings, warnings };
  }

  const input = raw as Record<string, unknown>;

  for (const key of Object.keys(NUMBER_FIELD_SPECS) as Array<
    keyof typeof NUMBER_FIELD_SPECS
  >) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;

    const num = typeof value === "number" ? value : Number(value);
    const spec = NUMBER_FIELD_SPECS[key];

    if (typeof num !== "number" || !Number.isFinite(num)) {
      warnings.push(`Ignored ${key}: must be a number.`);
      continue;
    }
    if (spec.integer && !Number.isInteger(num)) {
      warnings.push(`Ignored ${key}: must be an integer.`);
      continue;
    }
    if (spec.min !== undefined && num < spec.min) {
      warnings.push(`Ignored ${key}: must be >= ${spec.min}.`);
      continue;
    }
    if (spec.max !== undefined && num > spec.max) {
      warnings.push(`Ignored ${key}: must be <= ${spec.max}.`);
      continue;
    }

    settings[key] = num;
  }

  const stopSequence = input.stopSequence;
  if (typeof stopSequence === "string" && stopSequence.length > 0) {
    settings.stopSequence = stopSequence;
  } else if (stopSequence !== undefined && stopSequence !== null && stopSequence !== "") {
    warnings.push("Ignored stopSequence: must be a string.");
  }

  return { settings, warnings };
}

/**
 * Converts clean GenerationSettings into the shape the @google/genai SDK's
 * `generateContent` config expects. Only defined fields are included so
 * unset settings fall back to the model's own defaults.
 */
export function toGenerateContentConfig(settings: GenerationSettings) {
  const config: Record<string, unknown> = {};

  if (settings.temperature !== undefined) config.temperature = settings.temperature;
  if (settings.topK !== undefined) config.topK = settings.topK;
  if (settings.topP !== undefined) config.topP = settings.topP;
  if (settings.maxOutputTokens !== undefined)
    config.maxOutputTokens = settings.maxOutputTokens;
  if (settings.frequencyPenalty !== undefined)
    config.frequencyPenalty = settings.frequencyPenalty;
  if (settings.presencePenalty !== undefined)
    config.presencePenalty = settings.presencePenalty;
  if (settings.seed !== undefined) config.seed = settings.seed;
  if (settings.stopSequence) config.stopSequences = [settings.stopSequence];

  return config;
}

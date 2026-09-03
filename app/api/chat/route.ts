import { ApiError, GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GEMINI_MODEL, isSupportedGeminiModel } from "@/app/lib/models";
import {
  GenerationSettings,
  sanitizeGenerationSettings,
  toGenerateContentConfig,
} from "@/app/lib/generationSettings";

export const runtime = "nodejs";

const SETTING_LABELS: Record<keyof GenerationSettings, string> = {
  temperature: "Temperature",
  topK: "Top K",
  topP: "Top P",
  maxOutputTokens: "Output Tokens",
  frequencyPenalty: "Frequency Penalty",
  presencePenalty: "Presence Penalty",
  stopSequence: "Stop Sequence",
  seed: "Seed",
};

// Maps keywords found in a Gemini "invalid argument" error message to the
// settings fields responsible, so an unsupported field can be dropped and
// the request retried instead of failing outright.
const UNSUPPORTED_FIELD_RULES: {
  keywords: string[];
  fields: (keyof GenerationSettings)[];
}[] = [
  { keywords: ["penalty"], fields: ["frequencyPenalty", "presencePenalty"] },
  { keywords: ["top_k", "topk"], fields: ["topK"] },
  { keywords: ["top_p", "topp"], fields: ["topP"] },
  { keywords: ["temperature"], fields: ["temperature"] },
  { keywords: ["seed"], fields: ["seed"] },
  { keywords: ["stop_sequence", "stopsequence"], fields: ["stopSequence"] },
  {
    keywords: ["max_output_tokens", "maxoutputtokens", "output_tokens"],
    fields: ["maxOutputTokens"],
  },
];

const MAX_GENERATION_ATTEMPTS = 6;

export async function POST(request: NextRequest) {
  try {
    const { messages, model, settings: rawSettings } = await request.json();
    const selectedModel = isSupportedGeminiModel(model)
      ? model
      : DEFAULT_GEMINI_MODEL;

    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Convert chat messages to Gemini format
    const contents = messages.map(
      (msg: { role: string; content: string }) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      })
    );

    const { settings, warnings } = sanitizeGenerationSettings(rawSettings);
    const droppedFields = new Set<keyof GenerationSettings>();
    let workingSettings: GenerationSettings = { ...settings };
    let response;

    for (let attempt = 1; ; attempt++) {
      const config = toGenerateContentConfig(workingSettings);
      try {
        response = await ai.models.generateContent({
          model: selectedModel,
          contents,
          ...(Object.keys(config).length ? { config } : {}),
        });
        break;
      } catch (err) {
        const isUnsupportedArgument =
          err instanceof ApiError && err.status === 400;

        if (!isUnsupportedArgument || attempt >= MAX_GENERATION_ATTEMPTS) {
          throw err;
        }

        const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
        let culpritFields = UNSUPPORTED_FIELD_RULES.filter((rule) =>
          rule.keywords.some((kw) => message.includes(kw))
        ).flatMap((rule) => rule.fields);

        culpritFields = Array.from(new Set(culpritFields)).filter(
          (field) => workingSettings[field] !== undefined
        );

        // Can't tell which field caused it — drop everything remaining as a
        // last resort so the request can still succeed without settings.
        if (culpritFields.length === 0) {
          const remaining = Object.keys(workingSettings) as (keyof GenerationSettings)[];
          if (remaining.length === 0) throw err;
          culpritFields = remaining;
        }

        for (const field of culpritFields) {
          delete workingSettings[field];
          droppedFields.add(field);
        }
      }
    }

    const candidate = response.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "No response generated";

    const allWarnings = [...warnings];
    if (droppedFields.size > 0) {
      const labels = Array.from(droppedFields).map((f) => SETTING_LABELS[f]);
      allWarnings.push(
        `${selectedModel} doesn't support: ${labels.join(", ")}. These were ignored.`
      );
    }
    if (!candidate?.content?.parts?.length && candidate?.finishReason === "MAX_TOKENS") {
      allWarnings.push(
        "The Output Tokens limit was reached before a response could be generated. Try raising it."
      );
    }

    return NextResponse.json({
      text,
      ...(allWarnings.length ? { warnings: allWarnings } : {}),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof ApiError) {
      const friendlyMessages: Record<number, string> = {
        429: "This model has hit its rate limit or daily quota. Please wait a moment and try again, or switch models.",
        503: "This model is temporarily overloaded. Please try again in a few seconds.",
        400: "The model rejected the request. Try adjusting your settings and sending again.",
      };
      return NextResponse.json(
        {
          error:
            friendlyMessages[error.status] ||
            "Failed to generate response. Please try again.",
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate response. Please try again." },
      { status: 500 }
    );
  }
}

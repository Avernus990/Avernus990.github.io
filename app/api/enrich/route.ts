import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requestHasAccess, unauthorizedResponse } from "../../shared-auth";

type Definition = { example?: string };
type Meaning = { definitions?: Definition[] };
type Entry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Meaning[];
};

type GeminiResult = {
  phonetic?: string;
  part?: string;
  meanings?: string[];
};

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

const containsChinese = (value: string) => /[\u3400-\u9fff]/.test(value);

function formatPhonetic(value: string) {
  const phonetic = value.trim();
  if (!phonetic) return "";
  return phonetic.startsWith("/") ? phonetic : `/${phonetic.replace(/^\[|\]$/g, "")}/`;
}

async function fetchDictionary(word: string) {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const entries = await response.json() as Entry[];
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

async function enrichWithGemini(word: string, apiKey: string) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              `English word: ${word}`,
              "Return its standard IPA pronunciation, its most common part of speech in lowercase English,",
              "and 1 to 3 concise Simplified Chinese meanings ordered by frequency.",
              "Meanings must contain Chinese, with no numbering, no part of speech, and no English definition.",
            ].join("\n"),
          }],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 220,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              phonetic: { type: "string", description: "Standard IPA pronunciation wrapped in slashes." },
              part: { type: "string", description: "Most common English part of speech, lowercase." },
              meanings: {
                type: "array",
                minItems: 1,
                maxItems: 3,
                items: { type: "string", description: "A concise Simplified Chinese meaning." },
              },
            },
            required: ["phonetic", "part", "meanings"],
          },
        },
      }),
    },
  );

  const payload = await response.json() as GeminiPayload;
  if (!response.ok) throw new Error(payload.error?.message || "Gemini request failed");

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned no content");

  const result = JSON.parse(text) as GeminiResult;
  const meanings = (result.meanings ?? [])
    .map((meaning) => meaning.trim())
    .filter((meaning) => meaning && containsChinese(meaning))
    .slice(0, 3);
  if (!meanings.length) throw new Error("Gemini returned no Chinese meaning");

  return {
    phonetic: formatPhonetic(result.phonetic ?? ""),
    part: (result.part ?? "").trim().toLowerCase(),
    meanings,
  };
}

export async function GET(request: NextRequest) {
  if (!(await requestHasAccess(request))) return unauthorizedResponse();
  const word = request.nextUrl.searchParams.get("word")?.trim().toLowerCase();
  if (!word || !/^[a-z][a-z\s'-]*$/i.test(word)) {
    return NextResponse.json({ error: "请输入有效的英文单词" }, { status: 400 });
  }

  const apiKey = (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "智能补全尚未配置，请联系网站管理员" }, { status: 503 });
  }

  try {
    const [gemini, dictionary] = await Promise.all([
      enrichWithGemini(word, apiKey),
      fetchDictionary(word),
    ]);
    const dictionaryPhonetic = dictionary?.phonetic
      || dictionary?.phonetics?.find((item) => item.text)?.text
      || "";
    const examples = (dictionary?.meanings ?? [])
      .flatMap((meaning) => meaning.definitions ?? [])
      .map((definition) => definition.example)
      .filter((example): example is string => Boolean(example))
      .slice(0, 2);

    return NextResponse.json({
      word,
      phonetic: gemini.phonetic || formatPhonetic(dictionaryPhonetic),
      part: gemini.part,
      meaning: gemini.meanings.map((meaning, index) => `${index + 1}. ${meaning}`).join("\n"),
      examples,
      translationAvailable: true,
      source: "Gemini 2.5 Flash-Lite + Free Dictionary API",
    });
  } catch {
    return NextResponse.json({ error: "智能补全暂时不可用，请稍后再试" }, { status: 502 });
  }
}

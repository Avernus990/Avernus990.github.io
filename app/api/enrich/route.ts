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
  meanings?: Array<string | { part?: string; meaning?: string }>;
};

type GeminiPayload = {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

class GeminiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

class GeminiResultError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "GeminiResultError";
  }
}

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
  const prompt = [
    `English word: ${word}`,
    "Return its standard IPA pronunciation and 1 to 5 common meanings ordered by frequency.",
    "For every meaning, include that meaning's lowercase English part of speech and a concise Simplified Chinese translation.",
    "Include different common parts of speech when the word has them. Do not add numbering or English definitions.",
    'Reply with JSON only in this exact shape: {"phonetic":"/.../","meanings":[{"part":"noun","meaning":"中文释义"},{"part":"verb","meaning":"中文释义"}]}',
  ].join("\n");
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: "gemini-flash-lite-latest",
        input: prompt,
        store: false,
        generation_config: {
          temperature: 0.1,
          max_output_tokens: 320,
        },
      }),
    },
  );

  const responseText = await response.text();
  let payload: GeminiPayload;
  try {
    payload = JSON.parse(responseText) as GeminiPayload;
  } catch {
    throw new GeminiApiError("Gemini returned an unreadable response", response.status || 502);
  }
  if (!response.ok) {
    throw new GeminiApiError(payload.error?.message || "Gemini request failed", response.status);
  }

  const text = payload.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("")
    .trim();
  if (!text) throw new GeminiResultError("Gemini 没有返回可用内容");

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  const jsonText = objectStart >= 0 && objectEnd > objectStart
    ? unfenced.slice(objectStart, objectEnd + 1)
    : unfenced;
  let result: GeminiResult;
  try {
    result = JSON.parse(jsonText) as GeminiResult;
  } catch {
    throw new GeminiResultError("Gemini 返回的内容无法解析");
  }
  const fallbackPart = (result.part ?? "").trim().toLowerCase();
  const meanings = (result.meanings ?? [])
    .map((entry) => typeof entry === "string"
      ? { part: fallbackPart, meaning: entry.trim() }
      : {
          part: (entry.part ?? fallbackPart).trim().toLowerCase(),
          meaning: (entry.meaning ?? "").trim(),
        })
    .filter((entry) => entry.meaning && containsChinese(entry.meaning))
    .slice(0, 5);
  if (!meanings.length) throw new GeminiResultError("Gemini 没有返回中文释义");

  const parts = [...new Set(meanings.map((entry) => entry.part).filter(Boolean))];
  const hasMultipleParts = parts.length > 1;

  return {
    phonetic: formatPhonetic(result.phonetic ?? ""),
    part: hasMultipleParts ? "" : (parts[0] ?? fallbackPart),
    meanings: meanings.map((entry) => hasMultipleParts && entry.part
      ? `${entry.part}  ${entry.meaning}`
      : entry.meaning),
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
      source: "Gemini Flash-Lite + Free Dictionary API",
    });
  } catch (error) {
    if (error instanceof GeminiResultError) {
      return NextResponse.json({ error: error.userMessage }, { status: 502 });
    }
    if (error instanceof GeminiApiError) {
      if (error.status === 401 || error.status === 403) {
        return NextResponse.json({ error: "Gemini 密钥无效或没有访问权限" }, { status: 502 });
      }
      if (error.status === 429) {
        return NextResponse.json({ error: "Gemini 免费额度暂时已用完，请稍后再试" }, { status: 429 });
      }
      if (error.status === 400) {
        return NextResponse.json({ error: "Gemini 请求格式不受支持" }, { status: 502 });
      }
      return NextResponse.json(
        { error: `Gemini 服务返回错误（${error.status}）` },
        { status: 502 },
      );
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Gemini 响应超时，请稍后再试" }, { status: 504 });
    }
    return NextResponse.json(
      { error: `智能补全连接失败（${error instanceof Error ? error.name : "Unknown"}）` },
      { status: 502 },
    );
  }
}

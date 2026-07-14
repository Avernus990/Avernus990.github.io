import { NextRequest, NextResponse } from "next/server";
import { requestHasAccess, unauthorizedResponse } from "../../shared-auth";

type Definition = { definition?: string; example?: string };
type Meaning = { partOfSpeech?: string; definitions?: Definition[] };
type Entry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Meaning[];
};

const containsChinese = (value: string) => /[\u3400-\u9fff]/.test(value);

function decodeTranslation(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function translateWithMyMemory(text: string) {
  try {
    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 420))}&langpair=en|zh-CN`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6500) },
    );
    if (!response.ok) return "";

    const payload = await response.json() as {
      responseData?: { translatedText?: string };
      matches?: Array<{ translation?: string }>;
    };
    const candidates = [
      payload.responseData?.translatedText,
      ...(payload.matches ?? []).map((match) => match.translation),
    ];
    return candidates
      .map((candidate) => decodeTranslation(candidate?.trim() ?? ""))
      .find(containsChinese) ?? "";
  } catch {
    return "";
  }
}

async function translateWithGoogle(text: string) {
  try {
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text.slice(0, 420))}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6500) },
    );
    if (!response.ok) return "";
    const payload = await response.json() as Array<Array<[string?]>>;
    const translated = (payload[0] ?? [])
      .map((segment) => segment?.[0] ?? "")
      .join("")
      .trim();
    return containsChinese(translated) ? translated : "";
  } catch {
    return "";
  }
}

async function translateToChinese(text: string) {
  return await translateWithMyMemory(text) || await translateWithGoogle(text);
}

export async function GET(request: NextRequest) {
  if (!(await requestHasAccess(request))) return unauthorizedResponse();
  const word = request.nextUrl.searchParams.get("word")?.trim().toLowerCase();
  if (!word || !/^[a-z][a-z\s'-]*$/i.test(word)) {
    return NextResponse.json({ error: "请输入有效的英文单词" }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      return NextResponse.json({ error: "词典中暂时没有找到这个单词" }, { status: 404 });
    }

    const entries = await response.json() as Entry[];
    const entry = entries[0];
    const meanings = entry?.meanings ?? [];
    const definitions = meanings
      .flatMap((meaning) => meaning.definitions ?? [])
      .filter((definition) => definition.definition)
      .slice(0, 3);
    const chineseDefinitions: string[] = [];
    for (const definition of definitions) {
      const translated = await translateToChinese(definition.definition ?? "");
      if (containsChinese(translated)) chineseDefinitions.push(translated);
    }
    const chineseMeaning = chineseDefinitions
      .map((definition, index) => `${index + 1}. ${definition}`)
      .join("\n");

    const rawPhonetic = entry?.phonetic || entry?.phonetics?.find((item) => item.text)?.text || "";
    const examples = meanings
      .flatMap((meaning) => meaning.definitions ?? [])
      .map((definition) => definition.example)
      .filter((example): example is string => Boolean(example))
      .slice(0, 2);

    return NextResponse.json({
      word,
      phonetic: rawPhonetic ? (rawPhonetic.startsWith("/") ? rawPhonetic : `/${rawPhonetic}/`) : "",
      part: meanings[0]?.partOfSpeech || "",
      meaning: chineseMeaning,
      examples,
      translationAvailable: chineseDefinitions.length > 0,
      source: "Free Dictionary API + Chinese translation fallback",
    });
  } catch {
    return NextResponse.json({ error: "外部词典暂时无法连接，请稍后再试" }, { status: 502 });
  }
}

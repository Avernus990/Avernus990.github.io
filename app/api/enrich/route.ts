import { NextRequest, NextResponse } from "next/server";
import { requestHasAccess, unauthorizedResponse } from "../../shared-auth";

type Definition = { definition?: string; example?: string };
type Meaning = { partOfSpeech?: string; definitions?: Definition[] };
type Entry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Meaning[];
};

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
      .slice(0, 2);
    const englishMeaning = definitions.map((definition) => definition.definition).join("; ");

    let chineseMeaning = englishMeaning;
    if (englishMeaning) {
      const translationResponse = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(englishMeaning.slice(0, 480))}&langpair=en|zh-CN`,
        { headers: { Accept: "application/json" } },
      );
      if (translationResponse.ok) {
        const translation = await translationResponse.json() as {
          responseData?: { translatedText?: string };
        };
        chineseMeaning = translation.responseData?.translatedText || englishMeaning;
      }
    }

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
      source: "Free Dictionary API + MyMemory",
    });
  } catch {
    return NextResponse.json({ error: "外部词典暂时无法连接，请稍后再试" }, { status: 502 });
  }
}

interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

interface D1Database {
  prepare: (query: string) => D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  SITE_PASSWORD: string;
  GEMINI_API_KEY: string;
}

type Definition = { example?: string };
type DictionaryEntry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{ definitions?: Definition[] }>;
};
type GeminiResult = {
  phonetic?: string;
  part?: string;
  meanings?: Array<string | { part?: string; meaning?: string; common?: boolean }>;
  example?: string;
};
type GeminiPayload = {
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

const allowedOrigins = new Set([
  "https://avernus990.github.io",
  "https://lr-wordbook-shared.xieyuyang990.chatgpt.site",
  "http://localhost:4173",
]);

const notebookTable = `
  CREATE TABLE IF NOT EXISTS word_notebooks (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowedOrigins.has(origin.toLowerCase())) return new Headers();
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
}

function json(request: Request, data: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const createAccessToken = (password: string) => sha256(`${password}|lr-wordbook-shared-access`);

async function hasAccess(request: Request, env: Env) {
  const bearer = (request.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer || !env.SITE_PASSWORD) return false;
  return bearer === await createAccessToken(env.SITE_PASSWORD);
}

async function ensureNotebookTable(env: Env) {
  await env.DB.prepare(notebookTable).run();
}

function formatPhonetic(value: string) {
  const phonetic = value.trim();
  if (!phonetic) return "";
  return phonetic.startsWith("/") ? phonetic : `/${phonetic.replace(/^\[|\]$/g, "")}/`;
}

function highlightWord(example: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return example.replace(new RegExp(`\\b(${escaped})\\b`, "i"), "**$1**");
}

async function fetchDictionary(word: string) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const entries = await response.json() as DictionaryEntry[];
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

async function enrichWithGemini(word: string, apiKey: string) {
  const isPhrase = /\s/.test(word.trim());
  const prompt = [
    `English ${isPhrase ? "phrase" : "word"}: ${word}`,
    "Return its standard IPA pronunciation and 1 to 5 common meanings ordered by frequency.",
    isPhrase
      ? "For every meaning, include a precise lowercase phrase type and a concise Simplified Chinese translation."
      : "For every meaning, include that meaning's lowercase English part of speech and a concise Simplified Chinese translation.",
    "Do not add numbering or English definitions. Mark only the one or two most common everyday meanings with common: true.",
    `Also write one natural English example sentence that uses the exact spelling "${word}".`,
    `Reply with JSON only: {"phonetic":"/.../","meanings":[{"part":"${isPhrase ? "phrase type" : "noun"}","meaning":"中文释义","common":true}],"example":"One natural sentence."}`,
  ].join("\n");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: "gemini-flash-lite-latest",
      input: prompt,
      store: false,
      generation_config: { temperature: 0.1, max_output_tokens: 320 },
    }),
  });
  const payload = await response.json() as GeminiPayload;
  if (!response.ok) throw new Error(payload.error?.message || `Gemini 服务返回错误（${response.status}）`);
  const text = payload.steps?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini 没有返回可用内容");
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const result = JSON.parse(start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced) as GeminiResult;
  const fallbackPart = (result.part ?? "").trim().toLowerCase();
  const meanings = (result.meanings ?? []).map((entry) => typeof entry === "string"
    ? { part: fallbackPart, meaning: entry.trim(), common: false }
    : { part: (entry.part ?? fallbackPart).trim().toLowerCase(), meaning: (entry.meaning ?? "").trim(), common: entry.common === true })
    .filter((entry) => entry.meaning && /[\u3400-\u9fff]/.test(entry.meaning))
    .slice(0, 5);
  if (!meanings.length) throw new Error("Gemini 没有返回中文释义");
  const parts = [...new Set(meanings.map((entry) => entry.part).filter(Boolean))];
  const multipleParts = parts.length > 1;
  const markedCommon = meanings.some((entry) => entry.common);
  const formattedMeanings = meanings.map((entry, index) => {
    const meaning = entry.common || (!markedCommon && index === 0) ? `**${entry.meaning}**` : entry.meaning;
    return multipleParts && entry.part ? `${entry.part}  ${meaning}` : meaning;
  });
  const example = (result.example ?? "").trim();
  return {
    phonetic: formatPhonetic(result.phonetic ?? ""),
    part: multipleParts ? "" : (parts[0] ?? fallbackPart),
    meanings: formattedMeanings,
    example: example ? highlightWord(example, word) : "",
  };
}

async function handleAccess(request: Request, env: Env) {
  if (request.method === "GET") return json(request, { authenticated: await hasAccess(request, env) });
  if (request.method === "DELETE") return json(request, { authenticated: false });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  const body = await request.json() as { password?: string };
  if (!body.password || await createAccessToken(body.password) !== await createAccessToken(env.SITE_PASSWORD)) {
    return json(request, { error: "访问密码不正确" }, 401);
  }
  return json(request, { authenticated: true, accessToken: await createAccessToken(env.SITE_PASSWORD) });
}

async function handleNotebook(request: Request, env: Env) {
  if (!(await hasAccess(request, env))) return json(request, { error: "需要共享访问密码" }, 401);
  await ensureNotebookTable(env);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT content, updated_at FROM word_notebooks WHERE id = ?")
      .bind("default").first<{ content: string; updated_at: string }>();
    const stored = row ? JSON.parse(row.content) as unknown : null;
    const notebook = Array.isArray(stored)
      ? { pages: stored, activePageId: null, viewMode: "page", globalSort: "alphabetical" }
      : stored && typeof stored === "object" ? stored as Record<string, unknown> : null;
    return json(request, {
      pages: Array.isArray(notebook?.pages) ? notebook.pages : null,
      activePageId: typeof notebook?.activePageId === "string" ? notebook.activePageId : null,
      viewMode: notebook?.viewMode === "all" || notebook?.viewMode === "review" ? notebook.viewMode : "page",
      globalSort: notebook?.globalSort === "recent" || notebook?.globalSort === "part" ? notebook.globalSort : "alphabetical",
      updatedAt: row?.updated_at ?? null,
    });
  }
  if (request.method !== "PUT") return json(request, { error: "Method not allowed" }, 405);
  const body = await request.json() as Record<string, unknown>;
  if (!Array.isArray(body.pages)) return json(request, { error: "词汇页数据格式不正确" }, 400);
  const content = JSON.stringify({
    pages: body.pages,
    activePageId: typeof body.activePageId === "string" ? body.activePageId : null,
    viewMode: body.viewMode === "all" || body.viewMode === "review" ? body.viewMode : "page",
    globalSort: body.globalSort === "recent" || body.globalSort === "part" ? body.globalSort : "alphabetical",
  });
  if (content.length > 2_000_000) return json(request, { error: "词汇本数据过大" }, 413);
  await env.DB.prepare(`INSERT INTO word_notebooks (id, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP`)
    .bind("default", content).run();
  return json(request, { saved: true, updatedAt: new Date().toISOString() });
}

async function handleEnrich(request: Request, env: Env) {
  if (!(await hasAccess(request, env))) return json(request, { error: "需要共享访问密码" }, 401);
  const word = new URL(request.url).searchParams.get("word")?.trim().toLowerCase();
  if (!word || !/^[a-z][a-z\s'-]*$/i.test(word)) return json(request, { error: "请输入有效的英文单词" }, 400);
  if (!env.GEMINI_API_KEY) return json(request, { error: "智能补全尚未配置" }, 503);
  try {
    const [gemini, dictionary] = await Promise.all([enrichWithGemini(word, env.GEMINI_API_KEY), fetchDictionary(word)]);
    const dictionaryPhonetic = dictionary?.phonetic || dictionary?.phonetics?.find((item) => item.text)?.text || "";
    const dictionaryExamples = (dictionary?.meanings ?? []).flatMap((meaning) => meaning.definitions ?? [])
      .map((definition) => definition.example).filter((example): example is string => Boolean(example)).slice(0, 1);
    const examples = gemini.example ? [gemini.example] : dictionaryExamples.map((example) => highlightWord(example, word));
    return json(request, {
      word,
      phonetic: gemini.phonetic || formatPhonetic(dictionaryPhonetic),
      part: gemini.part,
      meaning: gemini.meanings.map((meaning, index) => `${index + 1}. ${meaning}`).join("\n"),
      examples,
      translationAvailable: true,
      source: "Gemini Flash-Lite + Free Dictionary API",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "智能补全连接失败";
    return json(request, { error: message }, message.includes("429") ? 429 : 502);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(request);
      return headers.has("Access-Control-Allow-Origin") ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403 });
    }
    try {
      if (url.pathname === "/api/access") return await handleAccess(request, env);
      if (url.pathname === "/api/notebook") return await handleNotebook(request, env);
      if (url.pathname === "/api/enrich" && request.method === "GET") return await handleEnrich(request, env);
      if (url.pathname === "/health") return json(request, { ok: true, service: "LR Wordbook API" });
      return json(request, { error: "Not found" }, 404);
    } catch (error) {
      return json(request, { error: error instanceof Error ? error.message : "服务器暂时不可用" }, 500);
    }
  },
};

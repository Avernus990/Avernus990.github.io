import { env } from "cloudflare:workers";
import { requestHasAccess, unauthorizedResponse } from "../../shared-auth";

const createNotebookTable = `
  CREATE TABLE IF NOT EXISTS word_notebooks (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

async function ensureNotebookTable() {
  if (!env.DB) throw new Error("网站数据库尚未配置");
  await env.DB.prepare(createNotebookTable).run();
}

export async function GET(request: Request) {
  try {
    if (!(await requestHasAccess(request))) return unauthorizedResponse();
    await ensureNotebookTable();
    const row = await env.DB.prepare("SELECT content, updated_at FROM word_notebooks WHERE id = ?")
      .bind("default")
      .first<{ content: string; updated_at: string }>();

    const stored = row ? JSON.parse(row.content) as unknown : null;
    const notebook = Array.isArray(stored)
      ? { pages: stored, activePageId: null, viewMode: "page" }
      : stored && typeof stored === "object"
        ? stored as { pages?: unknown; activePageId?: unknown; viewMode?: unknown }
        : null;

    return Response.json({
      pages: Array.isArray(notebook?.pages) ? notebook.pages : null,
      activePageId: typeof notebook?.activePageId === "string" ? notebook.activePageId : null,
      viewMode: notebook?.viewMode === "all" ? "all" : "page",
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "读取词汇本失败" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    if (!(await requestHasAccess(request))) return unauthorizedResponse();
    const body = await request.json() as { pages?: unknown; activePageId?: unknown; viewMode?: unknown };
    if (!Array.isArray(body.pages)) {
      return Response.json({ error: "词汇页数据格式不正确" }, { status: 400 });
    }

    const activePageId = typeof body.activePageId === "string" ? body.activePageId : null;
    const viewMode = body.viewMode === "all" ? "all" : "page";
    const content = JSON.stringify({ pages: body.pages, activePageId, viewMode });
    if (content.length > 2_000_000) {
      return Response.json({ error: "词汇本数据过大" }, { status: 413 });
    }

    await ensureNotebookTable();
    await env.DB.prepare(`
      INSERT INTO word_notebooks (id, content, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        updated_at = CURRENT_TIMESTAMP
    `).bind("default", content).run();

    return Response.json({ saved: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存词汇本失败" },
      { status: 500 },
    );
  }
}

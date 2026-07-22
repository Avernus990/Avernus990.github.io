"use client";

import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type WordCard = {
  id: number;
  word: string;
  phonetic: string;
  part: string;
  status: "学习中" | "待复习" | "已掌握";
  meaning: string;
  examples: string[];
  note: string;
  tone: "lilac" | "water" | "peach" | "sage";
  createdAt?: number;
};

type WordPage = { id: string; name: string; words: WordCard[] };
type ViewMode = "page" | "all" | "review";
type GlobalSort = "alphabetical" | "recent" | "part";

type SaveFileHandle = {
  createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<SaveFileHandle>;
};

const starterWords: WordCard[] = [
  { id: 1, word: "serendipity", phonetic: "/ˌser.ənˈdɪp.ə.ti/", part: "noun", status: "学习中", meaning: "意外发现美好事物的幸运；机缘巧合", examples: ["We met by pure serendipity.", "The discovery was a happy piece of serendipity."], note: "## 词语联想\n来自童话《锡兰三王子》，适合描述 **不期而遇的美好**。", tone: "lilac" },
  { id: 2, word: "tranquil", phonetic: "/ˈtræŋ.kwɪl/", part: "adjective", status: "待复习", meaning: "宁静的；平和的；不受打扰的", examples: ["The lake was tranquil at dawn.", "She felt tranquil among the trees."], note: "比 `quiet` 更偏向一种让人内心平静的氛围。", tone: "water" },
  { id: 3, word: "fleeting", phonetic: "/ˈfliː.tɪŋ/", part: "adjective", status: "已掌握", meaning: "短暂的；转瞬即逝的", examples: ["She caught a fleeting glimpse of the sea.", "Happiness can feel fleeting."], note: "- 常修饰 `glance`、`moment`、`feeling`\n- 带有诗意的短暂感", tone: "peach" },
  { id: 4, word: "meander", phonetic: "/miˈæn.dər/", part: "verb", status: "学习中", meaning: "蜿蜒而行；漫步；闲聊般偏离主题", examples: ["We meandered along the riverbank.", "The conversation meandered for hours."], note: "> 既能写河流和小路，也能形容谈话或思绪漫无目的地延伸。", tone: "sage" },
];

const starterPages: WordPage[] = [{ id: "page-1", name: "春日词语", words: starterWords }];
const tones: WordCard["tone"][] = ["lilac", "water", "peach", "sage"];
const statuses: Array<"全部" | WordCard["status"]> = ["全部", "学习中", "待复习", "已掌握"];
const wordEntryKey = (pageId: string, wordId: number) => `${pageId}:${wordId}`;
const remoteApiBase = "https://lr-wordbook-shared.xieyuyang990.chatgpt.site";
const accessTokenKey = "lr-wordbook-access-token";

function apiFetch(path: string, init: RequestInit = {}) {
  const useRemoteApi = typeof window !== "undefined" && (
    window.location.hostname.toLowerCase() === "avernus990.github.io"
    || (window.location.hostname === "localhost" && window.location.port === "4173")
  );
  const headers = new Headers(init.headers);
  if (useRemoteApi) {
    const accessToken = window.localStorage.getItem(accessTokenKey);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(`${useRemoteApi ? remoteApiBase : ""}${path}`, { ...init, headers });
}

function EditableText({ value, onChange, className = "", multiline = false, label, onBlur, autoFocus = false, onFocus, placeholder }: {
  value: string; onChange: (value: string) => void; className?: string; multiline?: boolean; label: string; onBlur?: () => void;
  autoFocus?: boolean; onFocus?: () => void; placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!multiline || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [multiline, value]);

  if (multiline) return <textarea ref={textareaRef} aria-label={label} className={`editable ${className}`} value={value} rows={2} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
  return <input aria-label={label} className={`editable ${className}`} value={value} placeholder={placeholder} autoFocus={autoFocus} onFocus={onFocus} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
}

function MarkdownEditableText({ value, onChange, className = "", label, placeholder }: {
  value: string; onChange: (value: string) => void; className?: string; label: string; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousValueRef = useRef(value);
  const focusOnEditRef = useRef(false);

  useEffect(() => {
    if (value !== previousValueRef.current && document.activeElement !== textareaRef.current) {
      setEditing(false);
    }
    previousValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!editing || !textareaRef.current) return;
    if (focusOnEditRef.current) textareaRef.current.focus();
    focusOnEditRef.current = false;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [editing, value]);

  const beginEditing = () => {
    focusOnEditRef.current = true;
    setEditing(true);
  };

  return editing
    ? <textarea ref={textareaRef} aria-label={label} className={`editable ${className}`} value={value} rows={2} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onBlur={() => setEditing(false)} />
    : <button type="button" className={`inline-markdown-preview ${className} ${value.trim() ? "" : "is-empty"}`} aria-label={`编辑${label}`} onClick={beginEditing}>{value.trim() ? value.split("\n").map((line, index) => <span className="inline-markdown-line" key={index}>{renderInlineMarkdown(line)}</span>) : <span className="inline-empty-placeholder">{placeholder || "点击输入内容"}</span>}</button>;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function MarkdownPreview({ content }: { content: string }) {
  return <div className="markdown-preview">{content.split("\n").map((line, index) => {
    if (line.startsWith("### ")) return <h5 key={index}>{renderInlineMarkdown(line.slice(4))}</h5>;
    if (line.startsWith("## ")) return <h4 key={index}>{renderInlineMarkdown(line.slice(3))}</h4>;
    if (line.startsWith("# ")) return <h3 key={index}>{renderInlineMarkdown(line.slice(2))}</h3>;
    if (line.startsWith("> ")) return <blockquote key={index}>{renderInlineMarkdown(line.slice(2))}</blockquote>;
    if (/^[-*] /.test(line)) return <div className="markdown-list" key={index}><span>•</span><p>{renderInlineMarkdown(line.slice(2))}</p></div>;
    if (!line.trim()) return <div className="markdown-space" key={index} />;
    return <p key={index}>{renderInlineMarkdown(line)}</p>;
  })}</div>;
}

function MarkdownNote({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusOnEditRef = useRef(false);

  useEffect(() => {
    if (!editing || !focusOnEditRef.current) return;
    textareaRef.current?.focus();
    focusOnEditRef.current = false;
  }, [editing]);

  const beginEditing = () => {
    focusOnEditRef.current = true;
    setEditing(true);
  };

  return <div className="markdown-note">
    {editing
      ? <textarea ref={textareaRef} aria-label={label} value={value} rows={5} placeholder="输入 Markdown 笔记，点击其他地方自动预览" onChange={(event) => onChange(event.target.value)} onBlur={() => setEditing(false)} />
      : <button type="button" className={`markdown-preview-trigger ${value.trim() ? "" : "is-empty"}`} aria-label={`编辑${label}`} onClick={beginEditing}>{value.trim() ? <MarkdownPreview content={value} /> : <span className="markdown-empty-placeholder">点击添加 Markdown 笔记</span>}</button>}
  </div>;
}

const statusStyles: Record<WordCard["status"], string> = { "学习中": "learning", "待复习": "reviewing", "已掌握": "mastered" };

function StatusPicker({ value, onChange, label }: { value: WordCard["status"]; onChange: (value: WordCard["status"]) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return <div className={`status-picker status-${statusStyles[value]}`} ref={pickerRef}>
    <button type="button" className="status-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><i /><span>{value}</span><b aria-hidden="true">⌄</b></button>
    {open && <div className="status-menu" role="listbox" aria-label={label}>
      {statuses.slice(1).map((status) => <button type="button" role="option" aria-selected={status === value} className={`status-option status-${statusStyles[status as WordCard["status"]]} ${status === value ? "active" : ""}`} key={status} onClick={() => { onChange(status as WordCard["status"]); setOpen(false); }}><i /><span>{status}</span>{status === value && <b>✓</b>}</button>)}
    </div>}
  </div>;
}

export default function Home() {
  const [pages, setPages] = useState<WordPage[]>(starterPages);
  const [activePageId, setActivePageId] = useState(starterPages[0].id);
  const [viewMode, setViewMode] = useState<ViewMode>("page");
  const [globalSort, setGlobalSort] = useState<GlobalSort>("alphabetical");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof statuses)[number]>("全部");
  const [ready, setReady] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [saveState, setSaveState] = useState<"正在读取" | "保存中" | "已保存" | "保存失败">("正在读取");
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "locked" | "unlocked">("checking");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState("");
  const [focusWordId, setFocusWordId] = useState<number | null>(null);
  const [undoAction, setUndoAction] = useState<{ label: string; undo: () => void } | null>(null);
  const [selectedWordKeys, setSelectedWordKeys] = useState<string[]>([]);
  const [batchTargetPageId, setBatchTargetPageId] = useState(starterPages[0].id);
  const pageMenuRef = useRef<HTMLDivElement>(null);

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const activePageIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
  const words = activePage?.words ?? [];
  const allWordEntries = useMemo(() => pages.flatMap((page) => page.words.map((word) => ({ pageId: page.id, pageName: page.name, word }))), [pages]);
  const reviewEntries = useMemo(() => allWordEntries.filter(({ word }) => word.status === "待复习"), [allWordEntries]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/access", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated?: boolean }>)
      .then((data) => { if (!cancelled) setAccessState(data.authenticated ? "unlocked" : "locked"); })
      .catch(() => { if (!cancelled) setAccessState("locked"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(event.target as Node)) setPageMenuOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPageMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  useEffect(() => {
    if (accessState !== "unlocked") return;
    let cancelled = false;
    const restorePages = async () => {
      try {
        const response = await apiFetch("/api/notebook", { cache: "no-store" });
        const data = await response.json() as { pages?: WordPage[] | null; activePageId?: string | null; viewMode?: ViewMode; globalSort?: GlobalSort; error?: string };
        if (!response.ok) throw new Error(data.error || "读取网站数据库失败");
        if (cancelled) return;
        if (data.pages?.length) {
          setPages(data.pages);
          setActivePageId(data.activePageId && data.pages.some((page) => page.id === data.activePageId) ? data.activePageId : data.pages[0].id);
          setViewMode(data.viewMode === "all" || data.viewMode === "review" ? data.viewMode : "page");
          setGlobalSort(data.globalSort === "recent" || data.globalSort === "part" ? data.globalSort : "alphabetical");
          setBatchTargetPageId(data.pages[0].id);
        } else {
          const savedPages = window.localStorage.getItem("monet-word-garden-pages");
          let pagesToMigrate = starterPages;
          if (savedPages) {
            const parsed = JSON.parse(savedPages) as WordPage[];
            if (parsed.length) pagesToMigrate = parsed;
          } else {
            const legacy = window.localStorage.getItem("monet-word-garden");
            if (legacy) {
              const parsed = JSON.parse(legacy) as Array<WordCard & { phrases?: string[] }>;
              pagesToMigrate = [{ id: "page-1", name: "我的第一页", words: parsed.map(({ phrases: _phrases, ...item }) => item) }];
            }
          }
          setPages(pagesToMigrate);
          setActivePageId(pagesToMigrate[0].id);
          const migrationResponse = await apiFetch("/api/notebook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: pagesToMigrate, activePageId: pagesToMigrate[0].id, viewMode: "page", globalSort: "alphabetical" }) });
          if (!migrationResponse.ok) throw new Error("现有数据迁移到后端失败");
          window.localStorage.removeItem("monet-word-garden-pages");
          window.localStorage.removeItem("monet-word-garden");
        }
      } catch (error) {
        if (!cancelled) {
          setSaveState("保存失败");
          setMessage(error instanceof Error ? error.message : "无法连接网站数据库");
        }
      } finally {
        if (!cancelled) {
          setReady(true);
          setSaveState((current) => current === "保存失败" ? current : "已保存");
        }
      }
    };
    void restorePages();
    return () => { cancelled = true; };
  }, [accessState]);

  useEffect(() => {
    if (!ready || accessState !== "unlocked") return;
    setSaveState("保存中");
    const timeout = window.setTimeout(() => {
      void apiFetch("/api/notebook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages, activePageId, viewMode, globalSort }) })
        .then(async (response) => {
          if (!response.ok) {
            const data = await response.json() as { error?: string };
            if (response.status === 401) {
              window.localStorage.removeItem(accessTokenKey);
              setAccessState("locked");
            }
            throw new Error(data.error || "保存失败");
          }
          setSaveState("已保存");
        })
        .catch((error) => {
          setSaveState("保存失败");
          setMessage(error instanceof Error ? error.message : "保存到网站后端失败");
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [pages, activePageId, viewMode, globalSort, ready, accessState]);

  useEffect(() => {
    if (!undoAction) return;
    const timeout = window.setTimeout(() => setUndoAction(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [undoAction]);

  useEffect(() => {
    if (!pages.some((page) => page.id === batchTargetPageId)) setBatchTargetPageId(pages[0]?.id ?? "");
  }, [pages, batchTargetPageId]);

  useEffect(() => {
    if (viewMode !== "page") return;
    setFocusWordId(null);
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const root = document.documentElement;
      const previousBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
      window.requestAnimationFrame(() => { root.style.scrollBehavior = previousBehavior; });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePageId, viewMode]);

  const visibleWords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return words.filter((item) => (filter === "全部" || item.status === filter) && (!keyword || `${item.word} ${item.meaning} ${item.note}`.toLowerCase().includes(keyword)));
  }, [words, query, filter]);

  const visibleGlobalWords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = allWordEntries.filter(({ pageName, word }) => (filter === "全部" || word.status === filter) && (!keyword || `${word.word} ${word.part} ${word.meaning} ${word.note} ${pageName}`.toLowerCase().includes(keyword)));
    return [...filtered].sort((left, right) => {
      if (globalSort === "recent") return (right.word.createdAt ?? right.word.id) - (left.word.createdAt ?? left.word.id);
      if (globalSort === "part") return (left.word.part || "zzzz").localeCompare(right.word.part || "zzzz", "en") || left.word.word.localeCompare(right.word.word, "en");
      return left.word.word.localeCompare(right.word.word, "en", { sensitivity: "base" });
    });
  }, [allWordEntries, query, filter, globalSort]);

  const updateActiveWords = (updater: (current: WordCard[]) => WordCard[]) => {
    setPages((current) => current.map((page) => page.id === activePageId ? { ...page, words: updater(page.words) } : page));
  };

  const updateWord = (id: number, patch: Partial<WordCard>) => updateActiveWords((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const updateWordOnPage = (pageId: string, id: number, patch: Partial<WordCard>) => setPages((current) => current.map((page) => page.id === pageId ? { ...page, words: page.words.map((item) => item.id === id ? { ...item, ...patch } : item) } : page));

  const updateExample = (id: number, index: number, value: string) => updateActiveWords((current) => current.map((item) => {
    if (item.id !== id) return item;
    const examples = [...item.examples]; examples[index] = value; return { ...item, examples };
  }));

  const removeExample = (id: number, index: number) => {
    const pageId = activePageId;
    const removed = words.find((item) => item.id === id)?.examples[index];
    if (removed === undefined) return;
    updateActiveWords((current) => current.map((item) => item.id === id ? { ...item, examples: item.examples.filter((_, exampleIndex) => exampleIndex !== index) } : item));
    setMessage("已删除例句");
    setUndoAction({ label: "撤销删除例句", undo: () => {
      setPages((current) => current.map((page) => page.id === pageId ? { ...page, words: page.words.map((item) => {
        if (item.id !== id) return item;
        const examples = [...item.examples]; examples.splice(index, 0, removed); return { ...item, examples };
      }) } : page));
      setMessage("已恢复例句"); setUndoAction(null);
    } });
  };

  const addWord = () => {
    const id = Date.now();
    setFocusWordId(id);
    updateActiveWords((current) => [{
      id, word: "", phonetic: "", part: "", status: "学习中", meaning: "", examples: [], note: "", createdAt: id,
      tone: tones[current.length % tones.length],
    }, ...current]);
  };

  const removeWord = (id: number) => {
    const pageId = activePageId;
    const index = words.findIndex((item) => item.id === id);
    const removed = words[index];
    if (!removed) return;
    updateActiveWords((current) => current.filter((item) => item.id !== id));
    setMessage(`已删除“${removed.word || "未命名词条"}”`);
    setUndoAction({ label: "撤销删除词条", undo: () => {
      setPages((current) => current.map((page) => page.id === pageId ? { ...page, words: [...page.words.slice(0, index), removed, ...page.words.slice(index)] } : page));
      setMessage(`已恢复“${removed.word || "未命名词条"}”`); setUndoAction(null);
    } });
  };

  const addExample = (id: number) => updateActiveWords((current) => current.map((item) => item.id === id ? { ...item, examples: [...item.examples, ""] } : item));

  const addPage = () => {
    const id = `page-${Date.now()}`;
    const nextPage = { id, name: `新词页 ${pages.length + 1}`, words: [] };
    setPages((current) => [...current, nextPage]);
    setActivePageId(id); setViewMode("page"); setQuery(""); setFilter("全部");
  };

  const renamePage = (name: string) => setPages((current) => current.map((page) => page.id === activePageId ? { ...page, name } : page));

  const deletePageById = (pageId: string) => {
    if (pages.length <= 1) return;
    const pageToDelete = pages.find((page) => page.id === pageId);
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    const remaining = pages.filter((page) => page.id !== pageId);
    setPages(remaining);
    if (pageId === activePageId) setActivePageId(remaining[Math.min(pageIndex, remaining.length - 1)].id);
    setMessage(`已删除“${pageToDelete?.name || "未命名页"}”`);
    if (pageToDelete) setUndoAction({ label: "撤销删除页面", undo: () => {
      setPages((current) => current.some((page) => page.id === pageId) ? current : [...current.slice(0, pageIndex), pageToDelete, ...current.slice(pageIndex)]);
      setActivePageId(pageId); setViewMode("page"); setMessage(`已恢复“${pageToDelete.name || "未命名页"}”`); setUndoAction(null);
    } });
  };

  const handleWordBlur = (item: WordCard) => {
    const normalized = item.word.trim().toLowerCase();
    if (!normalized) return;
    const duplicates = allWordEntries.filter(({ pageId, word }) => !(pageId === activePageId && word.id === item.id) && word.word.trim().toLowerCase() === normalized);
    if (duplicates.length) {
      const locations = [...new Set(duplicates.map(({ pageName }) => pageName || "未命名页"))];
      setMessage(`“${item.word}”已存在于：${locations.join("、")}`);
      return;
    }
    if (!item.phonetic || !item.meaning) void enrichWord(item.id);
  };

  const toggleWordSelection = (key: string) => setSelectedWordKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  const toggleAllVisibleWords = () => {
    const visibleKeys = visibleGlobalWords.map(({ pageId, word }) => wordEntryKey(pageId, word.id));
    const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedWordKeys.includes(key));
    setSelectedWordKeys((current) => allSelected ? current.filter((key) => !visibleKeys.includes(key)) : [...new Set([...current, ...visibleKeys])]);
  };

  const transferSelectedWords = (mode: "move" | "copy") => {
    if (!selectedWordKeys.length || !batchTargetPageId) return;
    const selectedSet = new Set(selectedWordKeys);
    const selectedEntries = allWordEntries.filter(({ pageId, word }) => selectedSet.has(wordEntryKey(pageId, word.id)));
    const transferable = mode === "move" ? selectedEntries.filter(({ pageId }) => pageId !== batchTargetPageId) : selectedEntries;
    if (!transferable.length) { setMessage("所选词条已经在目标页面中"); return; }
    const now = Date.now();
    const additions = transferable.map(({ word }, index) => ({ ...word, id: now + index, createdAt: mode === "copy" ? now + index : (word.createdAt ?? word.id) }));
    const movingKeys = new Set(transferable.map(({ pageId, word }) => wordEntryKey(pageId, word.id)));
    setPages((current) => current.map((page) => {
      const retained = mode === "move" ? page.words.filter((word) => !movingKeys.has(wordEntryKey(page.id, word.id))) : page.words;
      return page.id === batchTargetPageId ? { ...page, words: [...retained, ...additions] } : { ...page, words: retained };
    }));
    const targetName = pages.find((page) => page.id === batchTargetPageId)?.name || "目标页面";
    setSelectedWordKeys([]);
    setMessage(`已${mode === "move" ? "移动" : "复制"} ${additions.length} 个词条到“${targetName}”`);
  };

  const movePage = (pageId: string, direction: -1 | 1) => {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === pageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  };

  const enrichWord = async (id: number) => {
    const item = words.find((word) => word.id === id);
    if (!item?.word.trim() || loadingId !== null) return;
    setLoadingId(id); setMessage("");
    try {
      const response = await apiFetch(`/api/enrich?word=${encodeURIComponent(item.word.trim())}`);
      const data = await response.json() as { error?: string; phonetic?: string; part?: string; meaning?: string; examples?: string[]; translationAvailable?: boolean };
      if (!response.ok) throw new Error(data.error || "自动补全失败");
      updateWord(id, { phonetic: data.phonetic || item.phonetic, part: data.part || item.part, meaning: data.meaning || item.meaning, examples: data.examples?.length ? data.examples : item.examples });
      setMessage(data.translationAvailable === false
        ? `“${item.word}”的音标已补全，中文翻译服务暂时繁忙，请稍后再试`
        : `“${item.word}”已由在线词典自动补全`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "自动补全失败"); }
    finally { setLoadingId(null); }
  };

  const exportPdf = async () => {
    if (!activePage || exporting) return;
    const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("/", "-");
    const safeName = activePage.name.trim().replace(/[\\/:*?"<>|]/g, "-") || "未命名页";
    const filename = `${date} 英语词汇积累 - ${safeName}.pdf`;
    let fileHandle: SaveFileHandle | undefined;
    const savePicker = (window as SavePickerWindow).showSaveFilePicker;

    if (savePicker) {
      try {
        fileHandle = await savePicker({ suggestedName: filename, types: [{ description: "PDF 文档", accept: { "application/pdf": [".pdf"] } }] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    setExporting(true); setMessage("正在生成当前页 PDF…");
    try {
      const [{ createVocabularyPdf }, ...fontResponses] = await Promise.all([
        import("../lib/vocabulary-pdf"),
        fetch("/fonts/NotoSansSC-Regular.ttf"),
        fetch("/fonts/NotoSansSC-Bold.ttf"),
        fetch("/fonts/NotoSans-Regular.ttf"),
        fetch("/fonts/NotoSans-Bold.ttf"),
        fetch("/fonts/NotoSans-Italic.ttf"),
      ]);
      if (fontResponses.some((response) => !response.ok)) throw new Error("PDF 字体加载失败");
      const [cjkRegular, cjkBold, latinRegular, latinBold, latinItalic] = await Promise.all(fontResponses.map((response) => response.arrayBuffer()));
      const formattedDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date());
      const pdf = createVocabularyPdf(activePage, { cjkRegular, cjkBold, latinRegular, latinBold, latinItalic }, formattedDate);
      const totalPages = pdf.getNumberOfPages();

      const blob = pdf.output("blob");
      if (fileHandle) {
        const writable = await fileHandle.createWritable(); await writable.write(blob); await writable.close();
      } else {
        pdf.save(filename);
      }
      setMessage(`已导出“${activePage.name}”，共 ${totalPages} 页`);
    } catch (error) { setMessage(error instanceof Error ? `PDF 生成失败：${error.message}` : "PDF 生成失败"); }
    finally { setExporting(false); }
  };

  const submitAccessPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccessError("");
    try {
      const response = await apiFetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accessPassword }),
      });
      const data = await response.json() as { error?: string; accessToken?: string };
      if (!response.ok) throw new Error(data.error || "无法验证访问密码");
      if (data.accessToken) window.localStorage.setItem(accessTokenKey, data.accessToken);
      setReady(false);
      setAccessPassword("");
      setAccessState("unlocked");
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "访问密码不正确");
    }
  };

  const signOut = async () => {
    await apiFetch("/api/access", { method: "DELETE" });
    window.localStorage.removeItem(accessTokenKey);
    setReady(false);
    setAccessState("locked");
  };

  if (accessState !== "unlocked") {
    return <main className="access-page">
      <div className="access-wash access-wash-one" /><div className="access-wash access-wash-two" />
      <section className="access-card">
        <span className="access-monogram">LR</span>
        <p className="eyebrow">A SHARED WORD GARDEN</p>
        <h1>LR的单词本</h1>
        {accessState === "checking" ? <p className="access-checking">正在确认访问权限…</p> : <>
          <p className="access-intro">输入共享密码，进入大家共同编辑的英语词汇本。</p>
          <form onSubmit={submitAccessPassword}>
            <label htmlFor="shared-password">共享访问密码</label>
            <div className="access-input-row"><input id="shared-password" type="password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} autoComplete="current-password" autoFocus placeholder="请输入密码" /><button type="submit">进入词汇本</button></div>
          </form>
          {accessError && <p className="access-error" role="alert">{accessError}</p>}
        </>}
        <small>ONE NOTEBOOK · SHARED TOGETHER</small>
      </section>
    </main>;
  }

  return <main>
    <div className="wash wash-one" /><div className="wash wash-two" />
    <div className="shell">
      <header className="masthead">
        <div className="brand-row"><a className="brand" href="#top" aria-label="LR的单词本首页"><span className="brand-mark">LR</span><span>LR的单词本</span></a><div className="brand-actions"><p className="date-line">MY ENGLISH COLLECTION · {new Date().getFullYear()}</p><button onClick={signOut}>退出共享访问</button></div></div>
        <div className="hero" id="top"><div><p className="eyebrow">A quiet place for beautiful words</p><h1>拾起词语，<br /><em>收藏微光。</em></h1></div><div className="hero-note"><span className="soft-rule" /><p>把新单词写成一张张小卡片。释义、例句与联想，都在这里慢慢生长。</p></div></div>
      </header>

      <nav className="page-tabs page-list-selector" aria-label="词汇本分页">
        <div className="page-picker" ref={pageMenuRef}>
          <span className="page-picker-label">选择词汇页</span>
          <button className="page-picker-trigger" aria-haspopup="listbox" aria-expanded={pageMenuOpen} onClick={() => setPageMenuOpen((current) => !current)}>
            <span className="page-picker-number">{viewMode === "all" ? "∑" : viewMode === "review" ? "↻" : String(activePageIndex + 1).padStart(2, "0")}</span>
            <span className="page-picker-current"><strong>{viewMode === "all" ? "全部词汇" : viewMode === "review" ? "今日复习" : (activePage?.name || "未命名页")}</strong><small>{viewMode === "all" ? `${allWordEntries.length} 个词条 · ${pages.length} 个页面` : viewMode === "review" ? `${reviewEntries.length} 个待复习词条` : `${words.length} 个单词 · 点击切换页面`}</small></span>
            <span className={`page-picker-chevron ${pageMenuOpen ? "open" : ""}`} aria-hidden="true">⌄</span>
          </button>
          {pageMenuOpen && <div className="page-picker-menu" role="listbox" aria-label="选择词汇页">
            <div className="page-picker-menu-head"><span>全部页面</span><small>{pages.length} PAGES</small></div>
            <div className="page-picker-options">
              <div role="option" aria-selected={viewMode === "review"} className={`page-option smart-page-option ${viewMode === "review" ? "active" : ""}`}>
                <button className="page-option-main" onClick={() => { setViewMode("review"); setQuery(""); setFilter("全部"); setPageMenuOpen(false); }}>
                  <span className="option-number">↻</span>
                  <span className="option-copy"><strong>今日复习</strong><small>{reviewEntries.length ? `${reviewEntries.length} 个词条待复习` : "今天已经复习完啦"}</small></span>
                  <span className="option-status">{viewMode === "review" ? "当前" : "打开"}</span>
                </button>
              </div>
              <div role="option" aria-selected={viewMode === "all"} className={`page-option global-page-option ${viewMode === "all" ? "active" : ""}`}>
                <button className="page-option-main" onClick={() => { setViewMode("all"); setQuery(""); setFilter("全部"); setPageMenuOpen(false); }}>
                  <span className="option-number">∑</span>
                  <span className="option-copy"><strong>全部词汇</strong><small>{allWordEntries.length} 个词条 · 跨页面查找</small></span>
                  <span className="option-status">{viewMode === "all" ? "当前" : "打开"}</span>
                </button>
              </div>
              {pages.map((page, index) => <div key={page.id} role="option" aria-selected={viewMode === "page" && page.id === activePageId} className={`page-option ${viewMode === "page" && page.id === activePageId ? "active" : ""}`}>
                <button className="page-option-main" onClick={() => { setActivePageId(page.id); setViewMode("page"); setQuery(""); setFilter("全部"); setPageMenuOpen(false); }}>
                  <span className="option-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="option-copy"><strong>{page.name || "未命名页"}</strong><small>{page.words.length ? `${page.words.length} 个单词` : "空白页面"}</small></span>
                  <span className="option-status">{viewMode === "page" && page.id === activePageId ? "当前" : "打开"}</span>
                </button>
                <div className="page-option-actions">
                  <button disabled={index === 0} aria-label={`上移 ${page.name}`} onClick={() => movePage(page.id, -1)}>↑</button>
                  <button disabled={index === pages.length - 1} aria-label={`下移 ${page.name}`} onClick={() => movePage(page.id, 1)}>↓</button>
                  <button className="page-option-delete" disabled={pages.length === 1} aria-label={`删除 ${page.name}`} onClick={() => deletePageById(page.id)}>删除</button>
                </div>
              </div>)}
            </div>
          </div>}
        </div>
        <div className="page-list-actions"><span className={`save-indicator ${saveState === "保存中" ? "saving" : ""} ${saveState === "保存失败" ? "failed" : ""}`}><i />{saveState}到网站后端</span><button className="new-page-button" onClick={addPage}>＋ 新建一页</button></div>
      </nav>

      <section className="page-heading">
        {viewMode === "review"
          ? <div><p className="eyebrow">DAILY REVIEW</p><h2>今日复习</h2><small>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date())} · 集中复习所有标记为“待复习”的词条</small></div>
          : viewMode === "all"
          ? <div><p className="eyebrow">GLOBAL VOCABULARY</p><h2>全局词汇表</h2><small>集中查看和搜索所有页面里的词汇</small></div>
          : <div><p className="eyebrow">CURRENT PAGE</p><input aria-label="当前页名称" value={activePage?.name ?? ""} onChange={(event) => renamePage(event.target.value)} placeholder="为这一页命名" /></div>}
        {viewMode === "page" && pages.length > 1 && <button className="delete-page-button" onClick={() => deletePageById(activePageId)}>删除当前页</button>}
      </section>

      <section className="toolbar" aria-label="单词筛选工具">
        {viewMode === "review" ? <><div className="review-toolbar-copy"><strong>{reviewEntries.length}</strong><span>个词条等待复习</span></div><div /><div className="toolbar-actions"><button className="add-button" onClick={() => setViewMode("page")}>返回当前页</button></div></> : <>
          <label className="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder={viewMode === "all" ? "搜索全部页面…" : "搜索当前页…"} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="filters" aria-label="按学习状态筛选">{statuses.map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status}</button>)}</div>
          <div className="toolbar-actions">{viewMode === "all" ? <button className="add-button" onClick={() => setViewMode("page")}>返回当前页</button> : <><button className="export-button" disabled={exporting} onClick={exportPdf}>{exporting ? "正在生成…" : "下载当前页 PDF"}</button><button className="add-button" onClick={addWord}><span>＋</span> 添加单词</button></>}</div>
        </>}
      </section>
      {message && <div className="api-message" role="status"><span>{message}</span>{undoAction && <button onClick={undoAction.undo}>{undoAction.label}</button>}</div>}

      {viewMode === "review" ? <>
        <section className="collection-heading"><div><p className="eyebrow">A little every day</p><h2>今日清单</h2></div><p><strong>{reviewEntries.length}</strong> TO REVIEW</p></section>
        <section className="review-grid" aria-label="今日复习词条">
          {reviewEntries.map(({ pageId, pageName, word }, index) => <article className={`review-card ${word.tone}`} key={`${pageId}-${word.id}`}>
            <div className="review-card-top"><span>{String(index + 1).padStart(2, "0")}</span><small>{pageName || "未命名页"}</small></div>
            <h3>{word.word || "未命名词条"}</h3><p className="review-phonetic">{word.phonetic}</p>
            <div className="review-meaning">{word.meaning ? word.meaning.split("\n").map((line, lineIndex) => <p key={lineIndex}>{renderInlineMarkdown(line)}</p>) : "还没有释义"}</div>
            {word.examples.some(Boolean) && <div className="review-example">{renderInlineMarkdown(word.examples.find(Boolean) || "")}</div>}
            <div className="review-actions"><button onClick={() => { setActivePageId(pageId); setViewMode("page"); setQuery(""); setFilter("全部"); }}>打开词条</button><button className="review-master-button" onClick={() => { updateWordOnPage(pageId, word.id, { status: "已掌握" }); setMessage(`“${word.word}”已标记为已掌握`); }}>标记已掌握</button></div>
          </article>)}
        </section>
        {reviewEntries.length === 0 && <div className="review-complete"><span>✓</span><h3>今天的复习已经完成</h3><p>新的“待复习”词条会自动出现在这里。</p></div>}
      </> : viewMode === "all" ? <>
        <section className="collection-heading"><div><p className="eyebrow">Every word, one view</p><h2>词汇总览</h2></div><p><strong>{visibleGlobalWords.length}</strong> / {allWordEntries.length} ENTRIES</p></section>
        <section className="global-vocabulary" aria-label="全部词汇表">
          <div className="global-controls">
            <label>排序<select aria-label="全局词汇排序" value={globalSort} onChange={(event) => setGlobalSort(event.target.value as GlobalSort)}><option value="alphabetical">按字母 A–Z</option><option value="recent">按添加时间</option><option value="part">按词性 / 类型</option></select></label>
            <div className="batch-controls"><span>已选 {selectedWordKeys.length} 项</span><select aria-label="批量操作目标页面" value={batchTargetPageId} onChange={(event) => setBatchTargetPageId(event.target.value)}>{pages.map((page) => <option value={page.id} key={page.id}>{page.name || "未命名页"}</option>)}</select><button disabled={!selectedWordKeys.length} onClick={() => transferSelectedWords("move")}>移动</button><button disabled={!selectedWordKeys.length} onClick={() => transferSelectedWords("copy")}>复制</button></div>
          </div>
          <div className="global-table-wrap"><table className="global-table"><thead><tr><th className="global-select-column"><input type="checkbox" aria-label="选择当前筛选的全部词条" checked={visibleGlobalWords.length > 0 && visibleGlobalWords.every(({ pageId, word }) => selectedWordKeys.includes(wordEntryKey(pageId, word.id)))} onChange={toggleAllVisibleWords} /></th><th>词汇</th><th>类型 / 词性</th><th>中文释义</th><th>所在页面</th><th>状态</th></tr></thead><tbody>
            {visibleGlobalWords.map(({ pageId, pageName, word }) => <tr key={`${pageId}-${word.id}`}>
              <td className="global-select-column"><input type="checkbox" aria-label={`选择 ${word.word || "未命名词条"}`} checked={selectedWordKeys.includes(wordEntryKey(pageId, word.id))} onChange={() => toggleWordSelection(wordEntryKey(pageId, word.id))} /></td>
              <td><button className="global-word-button" onClick={() => { setActivePageId(pageId); setViewMode("page"); setQuery(""); setFilter("全部"); }}><strong>{word.word || "未命名词条"}</strong>{word.phonetic && <small>{word.phonetic}</small>}</button></td>
              <td><span className="global-part">{word.part || (word.word.trim().includes(" ") ? "phrase" : "—")}</span></td>
              <td><div className="global-meaning">{word.meaning ? word.meaning.split("\n").map((line, index) => <p key={index}>{renderInlineMarkdown(line)}</p>) : "—"}</div></td>
              <td><button className="global-page-button" onClick={() => { setActivePageId(pageId); setViewMode("page"); setQuery(""); setFilter("全部"); }}>{pageName || "未命名页"}<span>↗</span></button></td>
              <td><span className={`global-status status-${word.status}`}>{word.status}</span></td>
            </tr>)}
          </tbody></table></div>
        </section>
        {visibleGlobalWords.length === 0 && <div className="empty-state"><span>∿</span><p>{allWordEntries.length === 0 ? "词汇本还是空白的，先回到一个页面添加单词吧。" : "没有找到对应的词语，换个关键词试试。"}</p></div>}
      </> : <>
      <section className="collection-heading"><div><p className="eyebrow">The collection</p><h2>词语标本</h2></div><p><strong>{visibleWords.length}</strong> / {words.length} WORDS</p></section>
      <section className="card-grid" aria-label="单词卡片列表">{visibleWords.map((item, cardIndex) => <article className={`word-card ${item.tone}`} key={`${activePageId}-${item.id}`}>
        <div className="card-topline"><span>{String(cardIndex + 1).padStart(2, "0")}</span><StatusPicker label={`${item.word || "词条"} 的学习状态`} value={item.status} onChange={(status) => updateWord(item.id, { status })} /><div className="card-actions"><button className="enrich-button" disabled={loadingId !== null} onClick={() => enrichWord(item.id)}>{loadingId === item.id ? "查询中…" : "自动补全"}</button><button className="delete-button" aria-label={`删除 ${item.word}`} onClick={() => removeWord(item.id)}>×</button></div></div>
        <div className="word-title"><EditableText value={item.word} label="英文单词" className="word-input" placeholder="输入英文单词" autoFocus={focusWordId === item.id} onFocus={() => setFocusWordId(null)} onChange={(word) => updateWord(item.id, { word })} onBlur={() => handleWordBlur(item)} /><EditableText value={item.phonetic} label={`${item.word || "单词"} 的音标`} className="phonetic-input" placeholder="音标" onChange={(phonetic) => updateWord(item.id, { phonetic })} /></div>
        <div className="meaning-block"><span className="section-label">Meaning</span><div className="meaning-editor"><EditableText value={item.part} label={`${item.word || "词条"} 的${item.word.trim().includes(" ") ? "短语类型" : "词性"}`} className="part-input" placeholder={item.word.trim().includes(" ") ? "短语类型" : "词性"} onChange={(part) => updateWord(item.id, { part })} /><MarkdownEditableText value={item.meaning} label={`${item.word || "单词"} 的释义`} className="meaning-input" placeholder="中文释义" onChange={(meaning) => updateWord(item.id, { meaning })} /></div></div>
        <div className={`details-grid examples-only ${item.examples.length === 0 ? "empty-examples" : ""}`}><div>
          {item.examples.length > 0 && <><span className="section-label">Examples</span><ol>{item.examples.map((example, index) => <li key={index}><span>{index + 1}.</span><MarkdownEditableText value={example} label="英文例句" onChange={(value) => updateExample(item.id, index, value)} /><button className="delete-example-button" aria-label={`删除第 ${index + 1} 条例句`} title="删除例句" onClick={() => removeExample(item.id, index)}>×</button></li>)}</ol></>}
          <button className="add-example-button" onClick={() => addExample(item.id)}>＋ 添加例句</button>
        </div></div>
        <div className="note-block"><span>NOTE · MD</span><MarkdownNote value={item.note} label={`${item.word} 的 Markdown 学习笔记`} onChange={(note) => updateWord(item.id, { note })} /></div>
      </article>)}</section>

      {visibleWords.length === 0 && <div className="empty-state"><span>∿</span><p>{words.length === 0 ? "这一页还是空白的，从添加第一个单词开始吧。" : "没有找到对应的词语，换个关键词试试。"}</p></div>}
      </>}
      <footer><span>WORD GARDEN</span><p>Small words, quietly collected.</p><span>{activePage?.name || "UNTITLED"}</span></footer>
    </div>
  </main>;
}

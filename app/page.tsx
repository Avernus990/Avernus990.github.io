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
};

type WordPage = { id: string; name: string; words: WordCard[] };

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
  const [editing, setEditing] = useState(() => !value.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousValueRef = useRef(value);

  useEffect(() => {
    if (value !== previousValueRef.current && document.activeElement !== textareaRef.current) {
      setEditing(false);
    }
    previousValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!editing || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [editing, value]);

  return editing
    ? <textarea ref={textareaRef} aria-label={label} className={`editable ${className}`} value={value} rows={2} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onBlur={() => setEditing(false)} />
    : <button type="button" className={`inline-markdown-preview ${className}`} aria-label={`编辑${label}`} onClick={() => setEditing(true)}>{value.split("\n").map((line, index) => <span className="inline-markdown-line" key={index}>{renderInlineMarkdown(line)}</span>)}</button>;
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
  const [editing, setEditing] = useState(() => !value.trim());
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
      : <button type="button" className="markdown-preview-trigger" aria-label={`编辑${label}`} onClick={beginEditing}><MarkdownPreview content={value} /></button>}
  </div>;
}

function PdfExportStage({ page }: { page: WordPage }) {
  return <section className="pdf-export-stage" id="pdf-export-stage" aria-hidden="true">
    <header className="pdf-export-header" data-pdf-header>
      <p>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date())}</p>
      <h1>英语词汇积累</h1>
      <h2>{page.name}</h2>
      <span>{page.words.length} WORDS · WORD GARDEN</span>
    </header>
    {page.words.map((item, index) => <article className={`pdf-word-card ${item.tone}`} data-pdf-card key={item.id}>
      <div className="pdf-card-top"><span>{String(index + 1).padStart(2, "0")}</span><b>{item.status}</b></div>
      <h3>{item.word}</h3><p className="pdf-phonetic">{item.phonetic}</p>
      <div className="pdf-section"><small>MEANING</small><div className="pdf-meaning-row"><p className="pdf-part">{item.part}</p><div className="pdf-meaning">{item.meaning.split("\n").map((line, lineIndex) => <p key={lineIndex}>{renderInlineMarkdown(line)}</p>)}</div></div></div>
      {item.examples.some(Boolean) && <div className="pdf-section"><small>EXAMPLES</small><ol>{item.examples.filter(Boolean).map((example, exampleIndex) => <li key={exampleIndex}><span>{exampleIndex + 1}.</span><p>{renderInlineMarkdown(example)}</p></li>)}</ol></div>}
      <div className="pdf-note"><small>NOTE · MD</small><MarkdownPreview content={item.note} /></div>
    </article>)}
    {page.words.length === 0 && <div className="pdf-empty" data-pdf-card>这一页还没有单词。</div>}
  </section>;
}

export default function Home() {
  const [pages, setPages] = useState<WordPage[]>(starterPages);
  const [activePageId, setActivePageId] = useState(starterPages[0].id);
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
  const pageMenuRef = useRef<HTMLDivElement>(null);

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const activePageIndex = Math.max(0, pages.findIndex((page) => page.id === activePageId));
  const words = activePage?.words ?? [];

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/access", { cache: "no-store" })
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
        const response = await fetch("/api/notebook", { cache: "no-store" });
        const data = await response.json() as { pages?: WordPage[] | null; error?: string };
        if (!response.ok) throw new Error(data.error || "读取网站数据库失败");
        if (cancelled) return;
        if (data.pages?.length) {
          setPages(data.pages);
          setActivePageId(data.pages[0].id);
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
          const migrationResponse = await fetch("/api/notebook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: pagesToMigrate }) });
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
      void fetch("/api/notebook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages }) })
        .then(async (response) => {
          if (!response.ok) {
            const data = await response.json() as { error?: string };
            if (response.status === 401) setAccessState("locked");
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
  }, [pages, ready, accessState]);

  const visibleWords = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return words.filter((item) => (filter === "全部" || item.status === filter) && (!keyword || `${item.word} ${item.meaning} ${item.note}`.toLowerCase().includes(keyword)));
  }, [words, query, filter]);

  const updateActiveWords = (updater: (current: WordCard[]) => WordCard[]) => {
    setPages((current) => current.map((page) => page.id === activePageId ? { ...page, words: updater(page.words) } : page));
  };

  const updateWord = (id: number, patch: Partial<WordCard>) => updateActiveWords((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const updateExample = (id: number, index: number, value: string) => updateActiveWords((current) => current.map((item) => {
    if (item.id !== id) return item;
    const examples = [...item.examples]; examples[index] = value; return { ...item, examples };
  }));

  const addWord = () => {
    const id = Date.now();
    setFocusWordId(id);
    updateActiveWords((current) => [{
      id, word: "", phonetic: "", part: "", status: "学习中", meaning: "", examples: [], note: "",
      tone: tones[current.length % tones.length],
    }, ...current]);
  };

  const removeWord = (id: number) => updateActiveWords((current) => current.filter((item) => item.id !== id));

  const addExample = (id: number) => updateActiveWords((current) => current.map((item) => item.id === id ? { ...item, examples: [...item.examples, "Write an example sentence here."] } : item));

  const addPage = () => {
    const id = `page-${Date.now()}`;
    const nextPage = { id, name: `新词页 ${pages.length + 1}`, words: [] };
    setPages((current) => [...current, nextPage]);
    setActivePageId(id); setQuery(""); setFilter("全部");
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
      const response = await fetch(`/api/enrich?word=${encodeURIComponent(item.word.trim())}`);
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
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      await document.fonts.ready;
      const stage = document.getElementById("pdf-export-stage");
      if (!stage) throw new Error("未找到 PDF 内容");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = 210, pageHeight = 297, margin = 14, contentWidth = pageWidth - margin * 2, gap = 6;
      let cursorY = margin;
      const header = stage.querySelector<HTMLElement>("[data-pdf-header]");
      if (header) {
        const canvas = await html2canvas(header, { scale: 1.5, backgroundColor: "#f5f2e9", logging: false });
        const height = canvas.height * contentWidth / canvas.width;
        pdf.addImage(canvas.toDataURL("image/jpeg", .94), "JPEG", margin, cursorY, contentWidth, height, undefined, "FAST");
        cursorY += height + 8;
      }

      const cards = Array.from(stage.querySelectorAll<HTMLElement>("[data-pdf-card]"));
      for (const card of cards) {
        const canvas = await html2canvas(card, { scale: 1.5, backgroundColor: "#fbfaf5", logging: false });
        let width = contentWidth;
        let height = canvas.height * width / canvas.width;
        const maxHeight = pageHeight - margin * 2;
        if (height > maxHeight) { height = maxHeight; width = canvas.width * height / canvas.height; }
        if (cursorY + height > pageHeight - margin) { pdf.addPage(); cursorY = margin; }
        pdf.addImage(canvas.toDataURL("image/jpeg", .94), "JPEG", margin + (contentWidth - width) / 2, cursorY, width, height, undefined, "FAST");
        cursorY += height + gap;
      }

      const totalPages = pdf.getNumberOfPages();
      for (let index = 1; index <= totalPages; index += 1) {
        pdf.setPage(index); pdf.setFontSize(8); pdf.setTextColor(120, 128, 122); pdf.text(`${index} / ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: "right" });
      }

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
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accessPassword }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "无法验证访问密码");
      setReady(false);
      setAccessPassword("");
      setAccessState("unlocked");
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "访问密码不正确");
    }
  };

  const signOut = async () => {
    await fetch("/api/access", { method: "DELETE" });
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
            <span className="page-picker-number">{String(activePageIndex + 1).padStart(2, "0")}</span>
            <span className="page-picker-current"><strong>{activePage?.name || "未命名页"}</strong><small>{words.length} 个单词 · 点击切换页面</small></span>
            <span className={`page-picker-chevron ${pageMenuOpen ? "open" : ""}`} aria-hidden="true">⌄</span>
          </button>
          {pageMenuOpen && <div className="page-picker-menu" role="listbox" aria-label="选择词汇页">
            <div className="page-picker-menu-head"><span>全部页面</span><small>{pages.length} PAGES</small></div>
            <div className="page-picker-options">
              {pages.map((page, index) => <div key={page.id} role="option" aria-selected={page.id === activePageId} className={`page-option ${page.id === activePageId ? "active" : ""}`}>
                <button className="page-option-main" onClick={() => { setActivePageId(page.id); setQuery(""); setFilter("全部"); setPageMenuOpen(false); }}>
                  <span className="option-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="option-copy"><strong>{page.name || "未命名页"}</strong><small>{page.words.length ? `${page.words.length} 个单词` : "空白页面"}</small></span>
                  <span className="option-status">{page.id === activePageId ? "当前" : "打开"}</span>
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
        <div><p className="eyebrow">CURRENT PAGE</p><input aria-label="当前页名称" value={activePage?.name ?? ""} onChange={(event) => renamePage(event.target.value)} placeholder="为这一页命名" /></div>
        {pages.length > 1 && <button className="delete-page-button" onClick={() => deletePageById(activePageId)}>删除当前页</button>}
      </section>

      <section className="toolbar" aria-label="单词筛选工具">
        <label className="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="搜索当前页…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="filters" aria-label="按学习状态筛选">{statuses.map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status}</button>)}</div>
        <div className="toolbar-actions"><button className="export-button" disabled={exporting} onClick={exportPdf}>{exporting ? "正在生成…" : "下载当前页 PDF"}</button><button className="add-button" onClick={addWord}><span>＋</span> 添加单词</button></div>
      </section>
      {message && <p className="api-message" role="status">{message}</p>}

      <section className="collection-heading"><div><p className="eyebrow">The collection</p><h2>词语标本</h2></div><p><strong>{visibleWords.length}</strong> / {words.length} WORDS</p></section>
      <section className="card-grid" aria-label="单词卡片列表">{visibleWords.map((item, cardIndex) => <article className={`word-card ${item.tone}`} key={item.id}>
        <div className="card-topline"><span>{String(cardIndex + 1).padStart(2, "0")}</span><select aria-label={`${item.word} 的学习状态`} value={item.status} onChange={(event) => updateWord(item.id, { status: event.target.value as WordCard["status"] })}><option>学习中</option><option>待复习</option><option>已掌握</option></select><div className="card-actions"><button className="enrich-button" disabled={loadingId !== null} onClick={() => enrichWord(item.id)}>{loadingId === item.id ? "查询中…" : "自动补全"}</button><button className="delete-button" aria-label={`删除 ${item.word}`} onClick={() => removeWord(item.id)}>×</button></div></div>
        <div className="word-title"><EditableText value={item.word} label="英文单词" className="word-input" placeholder="输入英文单词" autoFocus={focusWordId === item.id} onFocus={() => setFocusWordId(null)} onChange={(word) => updateWord(item.id, { word })} onBlur={() => { if (!item.phonetic || !item.meaning) enrichWord(item.id); }} /><EditableText value={item.phonetic} label={`${item.word || "单词"} 的音标`} className="phonetic-input" placeholder="音标" onChange={(phonetic) => updateWord(item.id, { phonetic })} /></div>
        <div className="meaning-block"><span className="section-label">Meaning</span><div className="meaning-editor"><EditableText value={item.part} label={`${item.word || "单词"} 的词性`} className="part-input" placeholder="词性" onChange={(part) => updateWord(item.id, { part })} /><MarkdownEditableText value={item.meaning} label={`${item.word || "单词"} 的释义`} className="meaning-input" placeholder="中文释义" onChange={(meaning) => updateWord(item.id, { meaning })} /></div></div>
        <div className={`details-grid examples-only ${item.examples.length === 0 ? "empty-examples" : ""}`}><div>
          {item.examples.length > 0 && <><span className="section-label">Examples</span><ol>{item.examples.map((example, index) => <li key={index}><span>{index + 1}.</span><MarkdownEditableText value={example} label="英文例句" onChange={(value) => updateExample(item.id, index, value)} /></li>)}</ol></>}
          <button className="add-example-button" onClick={() => addExample(item.id)}>＋ 添加例句</button>
        </div></div>
        <div className="note-block"><span>NOTE · MD</span><MarkdownNote value={item.note} label={`${item.word} 的 Markdown 学习笔记`} onChange={(note) => updateWord(item.id, { note })} /></div>
      </article>)}</section>

      {visibleWords.length === 0 && <div className="empty-state"><span>∿</span><p>{words.length === 0 ? "这一页还是空白的，从添加第一个单词开始吧。" : "没有找到对应的词语，换个关键词试试。"}</p></div>}
      <footer><span>WORD GARDEN</span><p>Small words, quietly collected.</p><span>{activePage?.name || "UNTITLED"}</span></footer>
    </div>
    {activePage && <PdfExportStage page={activePage} />}
  </main>;
}

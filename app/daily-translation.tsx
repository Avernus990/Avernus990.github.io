"use client";

import { Fragment, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

export type DailyWordInfo = {
  word: string;
  phonetic: string;
  part: string;
  meaning: string;
  examples: string[];
};

type NotebookPage = { id: string; name: string; words: Array<{ word: string }> };
type DailyStore = {
  entries: Record<string, string>;
  words: Record<string, DailyWordInfo>;
};

const cacheKey = "lr-daily-translation-v1";
const emptyStore: DailyStore = { entries: {}, words: {} };

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStore() {
  if (typeof window === "undefined") return emptyStore;
  try {
    const saved = window.localStorage.getItem(cacheKey);
    if (!saved) return emptyStore;
    const parsed = JSON.parse(saved) as Partial<DailyStore>;
    return {
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
      words: parsed.words && typeof parsed.words === "object" ? parsed.words : {},
    };
  } catch {
    return emptyStore;
  }
}

function displayDate(value: string) {
  const parsed = new Date(`${value || localDate()}T12:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(parsed);
}

function inlineMarkdown(text: string, renderBold: (word: string, index: number) => ReactNode) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return renderBold(part.slice(2, -2), index);
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function plainContext(line: string) {
  return line
    .replace(/^#{1,3}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function normalizeLookup(value: string) {
  return value
    .trim()
    .replace(/^[^a-z]+|[^a-z]+$/gi, "")
    .replace(/\s+/g, " ");
}

function compactMeaning(value: string) {
  return value
    .split("\n")
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => line.replace(/^\d+\.\s*/, "").replace(/\*\*/g, ""))
    .join("；");
}

export default function DailyTranslation({
  pages,
  activePageId,
  onBack,
  onSignOut,
  enrichWord,
  addToNotebook,
}: {
  pages: NotebookPage[];
  activePageId: string;
  onBack: () => void;
  onSignOut: () => void;
  enrichWord: (word: string) => Promise<DailyWordInfo>;
  addToNotebook: (pageId: string, word: DailyWordInfo, context: string, date: string) => string;
}) {
  const [store, setStore] = useState<DailyStore>(() => readStore());
  const [date, setDate] = useState(() => localDate());
  const [editing, setEditing] = useState(true);
  const [selectedWord, setSelectedWord] = useState("");
  const [selectedContext, setSelectedContext] = useState("");
  const [selectedPageId, setSelectedPageId] = useState(activePageId);
  const [loadingWord, setLoadingWord] = useState("");
  const [wordError, setWordError] = useState("");
  const [choosingPage, setChoosingPage] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 180, left: 180 });
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const content = store.entries[date] ?? "";
  const selectedInfo = selectedWord ? store.words[selectedWord.toLowerCase()] : undefined;
  const cachedWords = useMemo(
    () => Object.values(store.words).slice(-8).reverse(),
    [store.words],
  );

  useEffect(() => {
    window.localStorage.setItem(cacheKey, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    if (pages.some((page) => page.id === activePageId)) setSelectedPageId(activePageId);
  }, [activePageId, pages]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setSelectedWord("");
        setChoosingPage(false);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedWord("");
        setChoosingPage(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  const updateContent = (value: string) => {
    setStore((current) => ({ ...current, entries: { ...current.entries, [date]: value } }));
  };

  const openWord = async (rawWord: string, context: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const word = normalizeLookup(rawWord);
    if (!word) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPopoverPosition({
      top: Math.min(window.innerHeight - 280, rect.bottom + 10),
      left: Math.min(window.innerWidth - 330, Math.max(14, rect.left - 40)),
    });
    setSelectedWord(word);
    setSelectedContext(plainContext(context));
    setSelectedPageId(activePageId);
    setChoosingPage(false);
    setWordError("");
    if (store.words[word.toLowerCase()] || loadingWord === word) return;
    setLoadingWord(word);
    try {
      const info = await enrichWord(word);
      setStore((current) => ({ ...current, words: { ...current.words, [word.toLowerCase()]: info } }));
    } catch (error) {
      setWordError(error instanceof Error ? error.message : "暂时无法查询这个词");
    } finally {
      setLoadingWord("");
    }
  };

  const renderLine = (line: string, index: number) => {
    const renderContent = (value: string) => inlineMarkdown(value, (word, tokenIndex) => (
      <button
        type="button"
        className="daily-lookup-word"
        key={`${index}-${tokenIndex}`}
        onClick={(event) => void openWord(word, line, event)}
      >
        {word}
      </button>
    ));
    if (!line.trim()) return <div className="daily-paragraph-space" key={index} />;
    if (line.startsWith("### ")) return <h3 key={index}>{renderContent(line.slice(4))}</h3>;
    if (line.startsWith("## ")) return <h2 key={index}>{renderContent(line.slice(3))}</h2>;
    if (line.startsWith("# ")) return <h1 key={index}>{renderContent(line.slice(2))}</h1>;
    if (line.startsWith("> ")) return <blockquote key={index}>{renderContent(line.slice(2))}</blockquote>;
    if (/^[-*] /.test(line)) return <div className="daily-list-line" key={index}><span>•</span><p>{renderContent(line.slice(2))}</p></div>;
    return <p key={index}>{renderContent(line)}</p>;
  };

  const importMarkdown = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md") && file.type && !file.type.includes("text")) {
      setNotice("请选择 Markdown 文本文件");
      return;
    }
    const text = await file.text();
    updateContent(text);
    setEditing(false);
    setNotice(`已载入 ${file.name}，内容保存在这台设备`);
  };

  const addSelectedWord = () => {
    if (!selectedInfo || !selectedPageId) return;
    const result = addToNotebook(selectedPageId, selectedInfo, selectedContext, date);
    setNotice(result);
    setChoosingPage(false);
    setSelectedWord("");
  };

  return <main className="daily-page">
    <div className="wash wash-one" /><div className="wash wash-two" />
    <div className="shell daily-shell">
      <header className="daily-masthead">
        <div className="brand-row">
          <button className="brand daily-brand" onClick={onBack} aria-label="返回 LR 的单词本">
            <span className="brand-mark">LR</span><span>LR的单词本</span>
          </button>
          <div className="brand-actions">
            <button className="daily-back-button" onClick={onBack}>返回单词本</button>
            <button onClick={onSignOut}>退出共享访问</button>
          </div>
        </div>
        <div className="daily-hero">
          <div><p className="eyebrow">A SENTENCE A DAY</p><h1>每日翻译，<br /><em>读懂一小段世界。</em></h1></div>
          <p>写下今天想翻译的英文，把值得记住的词用 <strong>**粗体**</strong> 标出来。点击它，就能查看释义并收进单词本。</p>
        </div>
      </header>

      <section className="daily-toolbar" aria-label="每日翻译工具">
        <label><span>练习日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value || localDate())} /></label>
        <button className="daily-soft-button" onClick={() => setDate(localDate())}>回到今天</button>
        <div className="daily-toolbar-spacer" />
        <input ref={fileInputRef} className="daily-file-input" type="file" accept=".md,text/markdown,text/plain" onChange={(event) => void importMarkdown(event.target.files?.[0])} />
        <button className="daily-soft-button" onClick={() => fileInputRef.current?.click()}>上传 Markdown</button>
        <button className="daily-mode-button" onClick={() => setEditing((current) => !current)}>{editing ? "预览与查词" : "继续编辑"}</button>
      </section>

      <section className="daily-workspace">
        <div className="daily-paper">
          <div className="daily-paper-head">
            <div><p className="eyebrow">{displayDate(date)}</p><h2>{editing ? "写下今日句子" : "今日译读"}</h2></div>
            <span>{content.length} CHARACTERS</span>
          </div>
          {editing
            ? <textarea
                className="daily-editor"
                aria-label="今日翻译 Markdown 内容"
                value={content}
                onChange={(event) => updateContent(event.target.value)}
                placeholder={"The quiet persistence of small steps can **transform** an ordinary day.\n\n把想查询的英文单词或短语写成 **粗体**，然后切换到预览。"}
              />
            : <article className={`daily-preview ${content.trim() ? "" : "is-empty"}`}>
                {content.trim()
                  ? content.split("\n").map(renderLine)
                  : <div className="daily-empty"><span>✦</span><h3>今天还没有句子</h3><p>继续编辑，或上传一个 Markdown 文件。</p></div>}
              </article>}
          <div className="daily-paper-foot"><span>内容自动缓存在当前设备</span><span>用 **单词** 标记可查询词语</span></div>
        </div>

        <aside className="daily-aside">
          <section>
            <p className="eyebrow">HOW IT WORKS</p>
            <h3>轻轻标记，慢慢积累</h3>
            <ol><li><span>01</span>输入句子或上传 Markdown</li><li><span>02</span>用双星号加粗重点词</li><li><span>03</span>预览时点击词语查释义</li></ol>
          </section>
          <section className="daily-cache-panel">
            <div><p className="eyebrow">LOCAL CACHE</p><small>{Object.keys(store.words).length} WORDS</small></div>
            <div className="daily-cache-list">
              {cachedWords.length
                ? cachedWords.map((item) => <button key={item.word} onClick={(event) => void openWord(item.word, item.examples[0] || item.word, event)}><strong>{item.word}</strong><span>{item.phonetic || "已缓存"}</span></button>)
                : <p>查询过的重点词会留在这里，下次点开无需再次请求。</p>}
            </div>
          </section>
        </aside>
      </section>

      {notice && <div className="daily-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
    </div>

    {selectedWord && <div
      className="daily-word-popover"
      ref={popoverRef}
      style={{ top: popoverPosition.top, left: popoverPosition.left }}
      role="dialog"
      aria-label={`${selectedWord} 的词义`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="daily-popover-top"><span>QUICK LOOK</span><button onClick={() => setSelectedWord("")} aria-label="关闭">×</button></div>
      <h3>{selectedWord}</h3>
      {loadingWord === selectedWord
        ? <div className="daily-word-loading"><i /><span>正在查询音标与中文大意…</span></div>
        : wordError
          ? <p className="daily-word-error">{wordError}</p>
          : selectedInfo && <>
              <p className="daily-word-phonetic">{selectedInfo.phonetic || "暂无音标"}{selectedInfo.part && <small>{selectedInfo.part}</small>}</p>
              <p className="daily-word-meaning">{compactMeaning(selectedInfo.meaning) || "暂无中文释义"}</p>
              {!choosingPage
                ? <button className="daily-add-word" onClick={() => setChoosingPage(true)}>＋ 添加到单词本</button>
                : <div className="daily-page-choice">
                    <span>选择词汇页</span>
                    <select value={selectedPageId} onChange={(event) => setSelectedPageId(event.target.value)}>
                      {pages.map((page) => <option value={page.id} key={page.id}>{page.name || "未命名页"} · {page.words.length} 词</option>)}
                    </select>
                    <button onClick={addSelectedWord}>确认添加</button>
                  </div>}
            </>}
    </div>}
  </main>;
}

import { strToU8, zipSync } from "fflate";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

type AnkiWord = {
  id: number;
  word: string;
  phonetic: string;
  part: string;
  status: string;
  meaning: string;
  examples: string[];
  note: string;
};

type AnkiPage = {
  id: string;
  name: string;
  words: AnkiWord[];
};

const modelId = 1735689600001;
const deckId = 1735689600002;
const fieldSeparator = "\u001f";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const inlineMarkdown = (value: string) => escapeHtml(value)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>");

function markdownToHtml(value: string) {
  const blocks: string[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    listItems = [];
  };

  value.split("\n").forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (/^[-*] /.test(line)) {
      listItems.push(inlineMarkdown(line.slice(2)));
      return;
    }
    flushList();
    if (!line.trim()) {
      blocks.push("<br>");
    } else if (line.startsWith("### ")) {
      blocks.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      blocks.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      blocks.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.startsWith("> ")) {
      blocks.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
    } else {
      blocks.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  });
  flushList();
  return blocks.join("");
}

function highlightWord(html: string, word: string) {
  const escapedWord = escapeHtml(word.trim());
  if (!escapedWord) return html;
  const pattern = escapedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyHighlighted = new RegExp(`<strong>\\s*${pattern}\\s*</strong>`, "i");
  return alreadyHighlighted.test(html)
    ? html
    : html.replace(new RegExp(pattern, "gi"), (match) => `<strong>${match}</strong>`);
}

async function checksum(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  const firstFour = new Uint8Array(digest).slice(0, 4);
  return firstFour.reduce((result, byte) => result * 256 + byte, 0);
}

function createSchema(database: import("sql.js").Database) {
  database.run(`
    CREATE TABLE col (
      id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL,
      scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
      usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
      models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
    );
    CREATE TABLE notes (
      id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL,
      mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL,
      flds text NOT NULL, sfld text NOT NULL, csum integer NOT NULL,
      flags integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE cards (
      id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL,
      ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL,
      type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL,
      ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
      lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL,
      odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE revlog (
      id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL,
      ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL,
      factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL
    );
    CREATE TABLE graves (
      usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL
    );
    CREATE INDEX ix_notes_usn ON notes (usn);
    CREATE INDEX ix_cards_usn ON cards (usn);
    CREATE INDEX ix_cards_nid ON cards (nid);
    CREATE INDEX ix_revlog_usn ON revlog (usn);
  `);
}

export async function createAnkiPackage(page: AnkiPage) {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const database = new SQL.Database();
  createSchema(database);

  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const fields = ["Word", "Phonetic", "Part", "Meaning", "Example", "Note", "Page", "Status"];
  const model = {
    [modelId]: {
      id: modelId,
      name: "LR Vocabulary",
      type: 0,
      mod: nowSeconds,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [{
        name: "Word → Meaning",
        ord: 0,
        qfmt: '<div class="word">{{Word}}</div><div class="phonetic">{{Phonetic}}</div>',
        afmt: '{{FrontSide}}<hr id="answer"><div class="part">{{Part}}</div><div class="meaning">{{Meaning}}</div>{{#Example}}<div class="section"><span>EXAMPLE</span>{{Example}}</div>{{/Example}}{{#Note}}<div class="section note"><span>NOTE</span>{{Note}}</div>{{/Note}}<div class="meta">{{Page}} · {{Status}}</div>',
        did: null,
        bqfmt: "",
        bafmt: "",
      }],
      flds: fields.map((name, ord) => ({
        name,
        ord,
        sticky: false,
        rtl: false,
        font: ord === 0 ? "Aptos" : "Arial",
        size: ord === 0 ? 34 : 18,
        description: "",
        plainText: false,
        collapsed: false,
        excludeFromSearch: false,
      })),
      css: `
.card { font-family: Arial, "Noto Sans SC", sans-serif; font-size: 18px; text-align: left; color: #30443a; background: #f8f6ee; padding: 28px; line-height: 1.65; }
.word { font-family: Georgia, serif; font-size: 38px; line-height: 1.2; color: #294239; }
.phonetic { margin-top: 8px; color: #738079; font-size: 16px; }
#answer { border: 0; border-top: 1px solid #cfd8d1; margin: 24px 0; }
.part { display: inline-block; margin-bottom: 10px; padding: 3px 9px; border-radius: 999px; color: #657269; background: #e6ece7; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.meaning { font-size: 20px; }
.section { margin-top: 22px; padding-top: 16px; border-top: 1px solid #dfe5df; }
.section > span { display: block; margin-bottom: 7px; color: #8b958e; font-size: 11px; font-weight: 700; letter-spacing: .14em; }
.section p { margin: 5px 0; }
.section ul { margin: 7px 0; padding-left: 22px; }
.section blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #b7c9bc; color: #657269; }
code { padding: 2px 5px; border-radius: 5px; background: #e8ebe5; }
.meta { margin-top: 24px; color: #9aa29c; font-size: 11px; letter-spacing: .08em; }
`,
      latexPre: "\\documentclass[12pt]{article}\\n\\special{papersize=3in,5in}\\n\\usepackage[utf8]{inputenc}\\n\\usepackage{amssymb,amsmath}\\n\\pagestyle{empty}\\n\\setlength{\\parindent}{0in}\\n\\begin{document}",
      latexPost: "\\end{document}",
      req: [[0, "all", [0]]],
      vers: [],
      tags: [],
    },
  };
  const decks = {
    [deckId]: {
      id: deckId,
      name: `LR的单词本::${page.name.trim() || "未命名页"}`,
      desc: "从 LR 的单词本导出",
      dyn: 0,
      collapsed: false,
      extendNew: 10,
      extendRev: 50,
      conf: 1,
      mod: nowSeconds,
      usn: -1,
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
    },
  };
  const deckConfig = {
    1: {
      id: 1,
      name: "Default",
      replayq: true,
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, perDay: 200 },
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4], order: 1, perDay: 20 },
      mod: 0,
      usn: 0,
      maxTaken: 60,
      timer: 0,
      autoplay: true,
    },
  };

  database.run(
    "INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [1, nowSeconds - 86400, now, now, 11, 0, 0, 0, "{}", JSON.stringify(model), JSON.stringify(decks), JSON.stringify(deckConfig), "{}"],
  );

  const noteStatement = database.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const cardStatement = database.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const validWords = page.words.filter((item) => item.word.trim());

  for (let index = 0; index < validWords.length; index += 1) {
    const item = validWords[index];
    const noteId = now + index;
    const cardId = now + 100000 + index;
    const exampleHtml = item.examples.filter((example) => example.trim())
      .map((example) => `<div>${highlightWord(inlineMarkdown(example), item.word)}</div>`)
      .join("");
    const values = [
      escapeHtml(item.word.trim()),
      escapeHtml(item.phonetic.trim()),
      escapeHtml(item.part.trim()),
      item.meaning.split("\n").filter(Boolean).map(inlineMarkdown).join("<br>"),
      exampleHtml,
      markdownToHtml(item.note),
      escapeHtml(page.name.trim()),
      escapeHtml(item.status),
    ];
    const tags = ` LR_wordbook page::${page.name.trim().replace(/\s+/g, "_")} status::${item.status.replace(/\s+/g, "_")} `;
    noteStatement.run([
      noteId,
      `lr-${page.id}-${item.id}`,
      modelId,
      nowSeconds,
      -1,
      tags,
      values.join(fieldSeparator),
      item.word.trim(),
      await checksum(item.word.trim()),
      0,
      "",
    ]);
    cardStatement.run([
      cardId,
      noteId,
      deckId,
      0,
      nowSeconds,
      -1,
      0,
      0,
      index + 1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      "",
    ]);
  }
  noteStatement.free();
  cardStatement.free();

  const collection = database.export();
  database.close();
  return new Blob([
    zipSync({
      "collection.anki2": collection,
      media: strToU8("{}"),
    }, { level: 6 }),
  ], { type: "application/octet-stream" });
}

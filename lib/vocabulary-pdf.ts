import { jsPDF } from "jspdf";

export type PdfWord = {
  word: string;
  phonetic: string;
  part: string;
  meaning: string;
  examples: string[];
  note: string;
  tone: "lilac" | "water" | "peach" | "sage";
};

export type PdfWordPage = { name: string; words: PdfWord[] };

const FONT_NAME = "NotoSansSC";
const LATIN_FONT_NAME = "NotoSans";
const PAGE_WIDTH = 210;
const MARGIN_X = 12;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const TABLE_TOP = 48;
const FOOTER_Y = 290;
const COLUMNS = [34, 20, 48, 45, 39];
const HEADERS = ["词汇", "类型 / 词性", "中文释义", "例句", "NOTE"];

const COLORS = {
  ink: "#293930",
  body: "#46544c",
  muted: "#758078",
  faint: "#9aa29c",
  line: "#d7ddd8",
  header: "#e9eee9",
  paper: "#fbfaf5",
  accentLine: "#8fa195",
} as const;

const ACCENTS: Record<PdfWord["tone"], string> = {
  lilac: "#aaa2c2",
  water: "#8fb7bd",
  peach: "#d3a092",
  sage: "#98aa9b",
};

function bufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function cleanMarkdown(value: string) {
  return value
    .split("\n")
    .map((line) => line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s+/, "❝ ")
      .replace(/^[-*]\s+/, "• ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .trim())
    .filter(Boolean)
    .join("\n");
}

function wrapLine(pdf: jsPDF, value: string, width: number) {
  const tokens = value.match(/[A-Za-zÀ-ɏ0-9][A-Za-zÀ-ɏ0-9'’./_-]*|\s+|./gu) ?? [];
  const lines: string[] = [];
  let current = "";
  const closingPunctuation = /^[，。；：！？、）》】”’…,.!?;:]$/u;

  tokens.forEach((token) => {
    if (/^\s+$/.test(token) && !current) return;
    const candidate = `${current}${token}`;
    if (!current || pdf.getTextWidth(candidate) <= width) {
      current = candidate;
      return;
    }
    if (closingPunctuation.test(token)) {
      current = candidate;
      return;
    }
    lines.push(current.trimEnd());
    current = /^\s+$/.test(token) ? "" : token.trimStart();
  });
  if (current.trim()) lines.push(current.trimEnd());
  if (lines.length > 1 && /^\p{Script=Han}$/u.test(lines.at(-1) ?? "")) {
    const previous = Array.from(lines.at(-2) ?? "");
    const moved = previous.pop();
    if (moved && /\p{Script=Han}/u.test(moved)) {
      lines[lines.length - 2] = previous.join("").trimEnd();
      lines[lines.length - 1] = `${moved}${lines.at(-1)}`;
    }
  }
  return lines.length ? lines : ["—"];
}

function wrappedLines(pdf: jsPDF, value: string, width: number, fallback = "—") {
  const cleaned = cleanMarkdown(value).trim() || fallback;
  return cleaned.split("\n").flatMap((line) => wrapLine(pdf, line, width));
}

function exampleLines(pdf: jsPDF, examples: string[], width: number) {
  const valid = examples.map(cleanMarkdown).filter(Boolean);
  if (!valid.length) return ["—"];
  return valid.flatMap((example, index) => wrapLine(pdf, `${index + 1}.  ${example}`, width));
}

function setText(pdf: jsPDF, size: number, color: string) {
  pdf.setFont(FONT_NAME, "normal");
  pdf.setFontSize(size);
  pdf.setTextColor(color);
}

function setWordText(pdf: jsPDF, size: number, color: string) {
  pdf.setFont("times", "normal");
  pdf.setFontSize(size);
  pdf.setTextColor(color);
}

function setLatinText(pdf: jsPDF, size: number, color: string) {
  pdf.setFont(LATIN_FONT_NAME, "normal");
  pdf.setFontSize(size);
  pdf.setTextColor(color);
}

function drawHeader(pdf: jsPDF, page: PdfWordPage, formattedDate: string) {
  pdf.setFillColor("#f5f2e9");
  pdf.rect(0, 0, PAGE_WIDTH, 44, "F");
  setText(pdf, 7.5, COLORS.muted);
  pdf.text(formattedDate, MARGIN_X, 16);
  setText(pdf, 22, COLORS.ink);
  pdf.text("英语词汇积累", MARGIN_X, 28.5);
  setText(pdf, 11.5, "#65746b");
  pdf.text(page.name || "未命名页", MARGIN_X, 37);
  setText(pdf, 7, COLORS.faint);
  pdf.text(`${page.words.length} WORDS  ·  LR'S WORD GARDEN`, PAGE_WIDTH - MARGIN_X, 37, { align: "right" });
  pdf.setDrawColor(COLORS.accentLine);
  pdf.setLineWidth(0.55);
  pdf.line(MARGIN_X, 43.5, PAGE_WIDTH - MARGIN_X, 43.5);
}

function drawTableHeader(pdf: jsPDF, y: number) {
  pdf.setFillColor(COLORS.header);
  pdf.setDrawColor(COLORS.line);
  pdf.setLineWidth(0.25);
  pdf.rect(MARGIN_X, y, CONTENT_WIDTH, 9, "FD");
  setText(pdf, 6.6, COLORS.muted);
  let x = MARGIN_X;
  HEADERS.forEach((header, index) => {
    pdf.text(header, x + 3, y + 5.7);
    x += COLUMNS[index];
    if (index < HEADERS.length - 1) pdf.line(x, y, x, y + 9);
  });
  return y + 9;
}

function fitWordSize(pdf: jsPDF, word: string, maxWidth: number) {
  for (let size = 14; size >= 8; size -= 0.5) {
    setWordText(pdf, size, COLORS.ink);
    if (pdf.getTextWidth(word) <= maxWidth) return size;
  }
  return 8;
}

function fitTextSize(pdf: jsPDF, text: string, maxWidth: number, preferred: number, minimum: number) {
  for (let size = preferred; size >= minimum; size -= 0.25) {
    setLatinText(pdf, size, COLORS.muted);
    if (pdf.getTextWidth(text) <= maxWidth) return size;
  }
  return minimum;
}

function drawLines(pdf: jsPDF, lines: string[], x: number, y: number, size: number, lineHeight: number, color = COLORS.body, latin = false) {
  if (latin) setLatinText(pdf, size, color);
  else setText(pdf, size, color);
  lines.forEach((line, index) => pdf.text(line, x, y + index * lineHeight));
}

type PreparedRow = {
  wordSize: number;
  partLines: string[];
  meaningLines: string[];
  exampleLines: string[];
  noteLines: string[];
  height: number;
};

function prepareRow(pdf: jsPDF, item: PdfWord): PreparedRow {
  setLatinText(pdf, 7.2, COLORS.body);
  const partLines = wrappedLines(pdf, item.part || (item.word.trim().includes(" ") ? "phrase" : "—"), COLUMNS[1] - 6);
  setText(pdf, 8.1, COLORS.body);
  const meaningLines = wrappedLines(pdf, item.meaning, COLUMNS[2] - 7);
  setLatinText(pdf, 7.6, COLORS.body);
  const examples = exampleLines(pdf, item.examples, COLUMNS[3] - 7);
  setText(pdf, 7.3, COLORS.body);
  const notes = wrappedLines(pdf, item.note, COLUMNS[4] - 7);
  const contentHeight = Math.max(partLines.length, meaningLines.length, examples.length, notes.length) * 3.75 + 7;
  return {
    wordSize: fitWordSize(pdf, item.word.trim() || "未命名词条", COLUMNS[0] - 7),
    partLines,
    meaningLines,
    exampleLines: examples,
    noteLines: notes,
    height: Math.max(24, contentHeight),
  };
}

function drawRow(pdf: jsPDF, item: PdfWord, index: number, y: number, prepared: PreparedRow) {
  const accent = ACCENTS[item.tone] || ACCENTS.lilac;
  pdf.setFillColor(COLORS.paper);
  pdf.setDrawColor(COLORS.line);
  pdf.setLineWidth(0.25);
  pdf.rect(MARGIN_X, y, CONTENT_WIDTH, prepared.height, "FD");
  pdf.setFillColor(accent);
  pdf.rect(MARGIN_X, y, 1.15, prepared.height, "F");
  let x = MARGIN_X;
  COLUMNS.slice(0, -1).forEach((width) => {
    x += width;
    pdf.line(x, y, x, y + prepared.height);
  });

  const wordX = MARGIN_X + 4;
  setText(pdf, 6.6, accent);
  pdf.text(String(index + 1).padStart(2, "0"), wordX, y + 5.4);
  const displayWord = item.word.trim() || "未命名词条";
  setWordText(pdf, prepared.wordSize, COLORS.ink);
  pdf.text(displayWord, wordX, y + 12.7);
  if (item.phonetic.trim()) {
    const phonetic = item.phonetic.trim();
    setLatinText(pdf, fitTextSize(pdf, phonetic, COLUMNS[0] - 7, 7, 5.25), COLORS.muted);
    pdf.text(phonetic, wordX, y + 18);
  }

  const textY = y + 6.2;
  const starts = [
    MARGIN_X + COLUMNS[0] + 3,
    MARGIN_X + COLUMNS[0] + COLUMNS[1] + 3.5,
    MARGIN_X + COLUMNS[0] + COLUMNS[1] + COLUMNS[2] + 3.5,
    MARGIN_X + COLUMNS[0] + COLUMNS[1] + COLUMNS[2] + COLUMNS[3] + 3.5,
  ];
  drawLines(pdf, prepared.partLines, starts[0], textY, 7.2, 3.75, COLORS.muted, true);
  drawLines(pdf, prepared.meaningLines, starts[1], textY, 8.1, 3.75);
  drawLines(pdf, prepared.exampleLines, starts[2], textY, 7.6, 3.75, "#59665e", true);
  drawLines(pdf, prepared.noteLines, starts[3], textY, 7.3, 3.75, "#59665e");
}

export function createVocabularyPdf(page: PdfWordPage, fontBuffer: ArrayBuffer, latinFontBuffer: ArrayBuffer, formattedDate: string) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  const fontData = bufferToBase64(fontBuffer);
  pdf.addFileToVFS("NotoSansSC-Regular.ttf", fontData);
  pdf.addFont("NotoSansSC-Regular.ttf", FONT_NAME, "normal");
  pdf.addFileToVFS("NotoSans-Regular.ttf", bufferToBase64(latinFontBuffer));
  pdf.addFont("NotoSans-Regular.ttf", LATIN_FONT_NAME, "normal");
  drawHeader(pdf, page, formattedDate);
  let cursorY = drawTableHeader(pdf, TABLE_TOP);

  if (!page.words.length) {
    pdf.setFillColor(COLORS.paper);
    pdf.setDrawColor(COLORS.line);
    pdf.rect(MARGIN_X, cursorY, CONTENT_WIDTH, 36, "FD");
    setText(pdf, 9, COLORS.muted);
    pdf.text("这一页还没有单词。", PAGE_WIDTH / 2, cursorY + 19, { align: "center" });
  } else {
    page.words.forEach((item, index) => {
      const prepared = prepareRow(pdf, item);
      if (cursorY + prepared.height > FOOTER_Y - 7) {
        pdf.addPage();
        drawHeader(pdf, page, formattedDate);
        cursorY = drawTableHeader(pdf, TABLE_TOP);
      }
      drawRow(pdf, item, index, cursorY, prepared);
      cursorY += prepared.height;
    });
  }

  const totalPages = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    pdf.setPage(pageNumber);
    setText(pdf, 6.5, COLORS.faint);
    pdf.text(`${pageNumber} / ${totalPages}`, PAGE_WIDTH - MARGIN_X, FOOTER_Y, { align: "right" });
  }
  return pdf;
}

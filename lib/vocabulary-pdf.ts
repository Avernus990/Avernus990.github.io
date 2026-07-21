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

type MarkdownStyle = "normal" | "bold" | "italic" | "code";
type FontFamily = "cjk" | "latin";
type StyledRun = { text: string; style: MarkdownStyle };
type StyledLine = StyledRun[];

function parseInlineMarkdown(value: string, baseStyle: MarkdownStyle = "normal") {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  return value.split(pattern).filter(Boolean).map<StyledRun>((part) => {
    if (part.startsWith("**") && part.endsWith("**")) return { text: part.slice(2, -2), style: "bold" };
    if (part.startsWith("`") && part.endsWith("`")) return { text: part.slice(1, -1), style: "code" };
    if (part.startsWith("*") && part.endsWith("*")) return { text: part.slice(1, -1), style: "italic" };
    return { text: part, style: baseStyle };
  });
}

function parseMarkdownLine(rawLine: string): StyledLine {
  let line = rawLine.trim();
  let prefix = "";
  let baseStyle: MarkdownStyle = "normal";
  if (/^#{1,6}\s+/.test(line)) {
    line = line.replace(/^#{1,6}\s+/, "");
    baseStyle = "bold";
  } else if (/^>\s+/.test(line)) {
    line = line.replace(/^>\s+/, "");
    prefix = "❝ ";
    baseStyle = "italic";
  } else if (/^[-*]\s+/.test(line)) {
    line = line.replace(/^[-*]\s+/, "");
    prefix = "• ";
  }
  return [...(prefix ? [{ text: prefix, style: baseStyle } satisfies StyledRun] : []), ...parseInlineMarkdown(line, baseStyle)];
}

function setRunFont(pdf: jsPDF, family: FontFamily, style: MarkdownStyle, text: string, size: number, color: string) {
  const containsHan = /\p{Script=Han}/u.test(text);
  if (family === "latin" || (style === "italic" && !containsHan)) {
    pdf.setFont(LATIN_FONT_NAME, style === "bold" ? "bold" : style === "italic" ? "italic" : "normal");
  } else {
    pdf.setFont(FONT_NAME, style === "bold" ? "bold" : "normal");
  }
  pdf.setFontSize(size);
  pdf.setTextColor(style === "code" ? "#435149" : color);
}

function appendRun(line: StyledLine, run: StyledRun) {
  if (!run.text) return;
  const previous = line.at(-1);
  if (previous?.style === run.style) previous.text += run.text;
  else line.push({ ...run });
}

function lineText(line: StyledLine) {
  return line.map((run) => run.text).join("");
}

function rebalanceChineseOrphan(lines: StyledLine[]) {
  if (lines.length < 2 || !/^\p{Script=Han}$/u.test(lineText(lines.at(-1) ?? []))) return;
  const previousLine = lines[lines.length - 2];
  for (let index = previousLine.length - 1; index >= 0; index -= 1) {
    const characters = Array.from(previousLine[index].text.trimEnd());
    const moved = characters.pop();
    if (!moved || !/\p{Script=Han}/u.test(moved)) continue;
    previousLine[index].text = characters.join("");
    lines[lines.length - 1].unshift({ text: moved, style: previousLine[index].style });
    return;
  }
}

function wrapStyledLine(pdf: jsPDF, runs: StyledLine, width: number, family: FontFamily, size: number) {
  const lines: StyledLine[] = [];
  let current: StyledLine = [];
  let currentWidth = 0;
  const closingPunctuation = /^[，。；：！？、）》】”’…,.!?;:]$/u;

  runs.forEach((run) => {
    const tokens = run.text.match(/[A-Za-zÀ-ɏ0-9][A-Za-zÀ-ɏ0-9'’./_-]*|\s+|./gu) ?? [];
    tokens.forEach((token) => {
      if (/^\s+$/.test(token) && !current.length) return;
      setRunFont(pdf, family, run.style, token, size, COLORS.body);
      const tokenWidth = pdf.getTextWidth(token);
      if (!current.length || currentWidth + tokenWidth <= width || closingPunctuation.test(token)) {
        appendRun(current, { text: token, style: run.style });
        currentWidth += tokenWidth;
        return;
      }
      lines.push(current);
      current = [];
      currentWidth = 0;
      if (!/^\s+$/.test(token)) {
        appendRun(current, { text: token.trimStart(), style: run.style });
        currentWidth = tokenWidth;
      }
    });
  });
  if (current.length) lines.push(current);
  rebalanceChineseOrphan(lines);
  return lines.length ? lines : [[{ text: "—", style: "normal" } satisfies StyledRun]];
}

function markdownLines(pdf: jsPDF, value: string, width: number, family: FontFamily, size: number, fallback = "—") {
  const sourceLines = value.split("\n").filter((line) => line.trim());
  const lines = sourceLines.length ? sourceLines : [fallback];
  return lines.flatMap((line) => wrapStyledLine(pdf, parseMarkdownLine(line), width, family, size));
}

function exampleLines(pdf: jsPDF, examples: string[], width: number, size: number) {
  const valid = examples.filter((example) => example.trim());
  if (!valid.length) return [[{ text: "—", style: "normal" } satisfies StyledRun]];
  return valid.flatMap((example, index) => wrapStyledLine(pdf, [{ text: `${index + 1}.  `, style: "normal" }, ...parseInlineMarkdown(example)], width, "latin", size));
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

function drawStyledLines(pdf: jsPDF, lines: StyledLine[], x: number, y: number, size: number, lineHeight: number, color = COLORS.body, family: FontFamily = "cjk") {
  lines.forEach((line, lineIndex) => {
    let cursorX = x;
    const baseline = y + lineIndex * lineHeight;
    line.forEach((run) => {
      setRunFont(pdf, family, run.style, run.text, size, color);
      const runWidth = pdf.getTextWidth(run.text);
      if (run.style === "code") {
        pdf.setFillColor("#e9ece7");
        pdf.roundedRect(cursorX - 0.45, baseline - size * 0.31, runWidth + 0.9, size * 0.39, 0.6, 0.6, "F");
        setRunFont(pdf, family, run.style, run.text, size, color);
      }
      pdf.text(run.text, cursorX, baseline);
      cursorX += runWidth;
    });
  });
}

type PreparedRow = {
  wordSize: number;
  partLines: StyledLine[];
  meaningLines: StyledLine[];
  exampleLines: StyledLine[];
  noteLines: StyledLine[];
  height: number;
};

function prepareRow(pdf: jsPDF, item: PdfWord): PreparedRow {
  const partLines = markdownLines(pdf, item.part || (item.word.trim().includes(" ") ? "phrase" : "—"), COLUMNS[1] - 6, "latin", 7.2);
  const meaningLines = markdownLines(pdf, item.meaning, COLUMNS[2] - 7, "cjk", 8.1);
  const examples = exampleLines(pdf, item.examples, COLUMNS[3] - 7, 7.6);
  const notes = markdownLines(pdf, item.note, COLUMNS[4] - 7, "cjk", 7.3);
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
  drawStyledLines(pdf, prepared.partLines, starts[0], textY, 7.2, 3.75, COLORS.muted, "latin");
  drawStyledLines(pdf, prepared.meaningLines, starts[1], textY, 8.1, 3.75);
  drawStyledLines(pdf, prepared.exampleLines, starts[2], textY, 7.6, 3.75, "#59665e", "latin");
  drawStyledLines(pdf, prepared.noteLines, starts[3], textY, 7.3, 3.75, "#59665e");
}

export type PdfFontBuffers = {
  cjkRegular: ArrayBuffer;
  cjkBold: ArrayBuffer;
  latinRegular: ArrayBuffer;
  latinBold: ArrayBuffer;
  latinItalic: ArrayBuffer;
};

export function createVocabularyPdf(page: PdfWordPage, fonts: PdfFontBuffers, formattedDate: string) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS("NotoSansSC-Regular.ttf", bufferToBase64(fonts.cjkRegular));
  pdf.addFont("NotoSansSC-Regular.ttf", FONT_NAME, "normal");
  pdf.addFileToVFS("NotoSansSC-Bold.ttf", bufferToBase64(fonts.cjkBold));
  pdf.addFont("NotoSansSC-Bold.ttf", FONT_NAME, "bold");
  pdf.addFileToVFS("NotoSans-Regular.ttf", bufferToBase64(fonts.latinRegular));
  pdf.addFont("NotoSans-Regular.ttf", LATIN_FONT_NAME, "normal");
  pdf.addFileToVFS("NotoSans-Bold.ttf", bufferToBase64(fonts.latinBold));
  pdf.addFont("NotoSans-Bold.ttf", LATIN_FONT_NAME, "bold");
  pdf.addFileToVFS("NotoSans-Italic.ttf", bufferToBase64(fonts.latinItalic));
  pdf.addFont("NotoSans-Italic.ttf", LATIN_FONT_NAME, "italic");
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

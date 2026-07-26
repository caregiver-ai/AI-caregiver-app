import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import {
  type CareRecordCategory,
  type CareRecordField,
  type CareRecordSourceType,
  getCareRecordCategoryTitle,
  groupCareRecordItemsByCategory
} from "@/lib/care-records";
import { APP_NAME } from "@/lib/constants";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 48;
const PAGE_MARGIN_Y = 56;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_X * 2;
const TITLE_SIZE = 22;
const SECTION_TITLE_SIZE = 12;
const BODY_SIZE = 11;
const SMALL_SIZE = 9;
const LINE_GAP = 5;
const SECTION_GAP = 18;
const ITEM_GAP = 8;
const BULLET_GAP = 10;

type PageState = {
  page: PDFPage;
  y: number;
};

type PdfColor = NonNullable<NonNullable<Parameters<PDFPage["drawText"]>[1]>["color"]>;

export interface LifeRecordPdfItem {
  id: string;
  category: CareRecordCategory;
  title: string;
  fields: CareRecordField[];
  notes: string;
  sourceType: CareRecordSourceType;
  sourceLabel: string;
}

function createPage(pdf: PDFDocument): PageState {
  return {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - PAGE_MARGIN_Y
  };
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let currentLine = "";

  function splitLongWord(word: string) {
    const segments: string[] = [];
    let remaining = word;

    while (remaining.length > 0) {
      let sliceLength = remaining.length;
      while (
        sliceLength > 1 &&
        font.widthOfTextAtSize(remaining.slice(0, sliceLength), fontSize) > maxWidth
      ) {
        sliceLength -= 1;
      }

      segments.push(remaining.slice(0, sliceLength));
      remaining = remaining.slice(sliceLength);
    }

    return segments;
  }

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      currentLine = word;
      continue;
    }

    const segments = splitLongWord(word);
    lines.push(...segments.slice(0, -1));
    currentLine = segments[segments.length - 1] ?? "";
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function ensureSpace(pdf: PDFDocument, state: PageState, requiredHeight: number) {
  if (state.y - requiredHeight >= PAGE_MARGIN_Y) {
    return state;
  }

  return createPage(pdf);
}

function drawWrappedLines(
  pdf: PDFDocument,
  state: PageState,
  lines: string[],
  font: PDFFont,
  fontSize: number,
  color: PdfColor,
  x: number
) {
  let nextState = state;
  const lineHeight = fontSize + LINE_GAP;

  for (const line of lines) {
    nextState = ensureSpace(pdf, nextState, lineHeight);
    nextState.page.drawText(line, {
      x,
      y: nextState.y - fontSize,
      size: fontSize,
      font,
      color
    });
    nextState = {
      ...nextState,
      y: nextState.y - lineHeight
    };
  }

  return nextState;
}

function drawParagraph(
  pdf: PDFDocument,
  state: PageState,
  text: string,
  font: PDFFont,
  fontSize: number,
  color: PdfColor,
  width = CONTENT_WIDTH,
  x = PAGE_MARGIN_X
) {
  const lines = wrapText(text, font, fontSize, width);
  return drawWrappedLines(pdf, state, lines, font, fontSize, color, x);
}

function drawBulletItem(
  pdf: PDFDocument,
  state: PageState,
  text: string,
  font: PDFFont,
  color: PdfColor,
  x = PAGE_MARGIN_X,
  width = CONTENT_WIDTH
) {
  const bulletWidth = 12;
  const lines = wrapText(text, font, BODY_SIZE, width - bulletWidth);
  if (lines.length === 0) {
    return state;
  }

  let nextState = ensureSpace(pdf, state, BODY_SIZE + LINE_GAP);
  nextState.page.drawText("•", {
    x,
    y: nextState.y - BODY_SIZE,
    size: BODY_SIZE,
    font,
    color
  });
  nextState = drawWrappedLines(
    pdf,
    nextState,
    lines,
    font,
    BODY_SIZE,
    color,
    x + bulletWidth
  );

  return {
    ...nextState,
    y: nextState.y - ITEM_GAP
  };
}

function formatPreparedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(parsed);
}

function drawRecordItem(
  pdf: PDFDocument,
  state: PageState,
  item: LifeRecordPdfItem,
  regularFont: PDFFont,
  boldFont: PDFFont,
  slate: PdfColor,
  muted: PdfColor
) {
  let nextState = ensureSpace(pdf, state, BODY_SIZE * 3);
  nextState = drawParagraph(pdf, nextState, item.title, boldFont, BODY_SIZE, slate);

  const source = `${item.sourceLabel} (${item.sourceType})`;
  if (source.trim()) {
    nextState = drawParagraph(
      pdf,
      nextState,
      `Source: ${source}`,
      regularFont,
      SMALL_SIZE,
      muted,
      CONTENT_WIDTH - 16,
      PAGE_MARGIN_X + 16
    );
    nextState.y -= 2;
  }

  for (const field of item.fields) {
    nextState = drawBulletItem(
      pdf,
      nextState,
      `${field.label}: ${field.value}`,
      regularFont,
      slate,
      PAGE_MARGIN_X + 16,
      CONTENT_WIDTH - 16
    );
  }

  if (item.notes.trim()) {
    nextState = drawBulletItem(
      pdf,
      nextState,
      `Notes: ${item.notes.trim()}`,
      regularFont,
      slate,
      PAGE_MARGIN_X + 16,
      CONTENT_WIDTH - 16
    );
  }

  return {
    ...nextState,
    y: nextState.y - BULLET_GAP
  };
}

export async function createLifeRecordsPdf(items: LifeRecordPdfItem[], preparedAt: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const slate = rgb(0.20, 0.27, 0.38);
  const muted = rgb(0.42, 0.49, 0.59);
  let state = createPage(pdf);

  state.page.drawText(APP_NAME, {
    x: PAGE_MARGIN_X,
    y: state.y,
    size: SMALL_SIZE,
    font: boldFont,
    color: rgb(0.07, 0.50, 0.47)
  });
  state.y -= SMALL_SIZE + 10;

  state = drawParagraph(pdf, state, "Life Records", boldFont, TITLE_SIZE, slate);
  state.y -= 8;

  const preparedAtText = formatPreparedAt(preparedAt);
  if (preparedAtText) {
    state.page.drawText(`Document prepared: ${preparedAtText}`, {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: SMALL_SIZE,
      font: regularFont,
      color: muted
    });
    state.y -= SMALL_SIZE + 12;
  }

  state = drawParagraph(
    pdf,
    state,
    "Bring together the records caregivers rely on.",
    regularFont,
    BODY_SIZE,
    slate
  );
  state.y -= ITEM_GAP;
  state = drawParagraph(
    pdf,
    state,
    "Uploaded files are used only for extraction and are not stored.",
    regularFont,
    BODY_SIZE,
    slate
  );
  state.y -= SECTION_GAP;

  if (items.length === 0) {
    state = drawParagraph(
      pdf,
      state,
      "No Life Records are ready yet.",
      regularFont,
      BODY_SIZE,
      slate
    );
    return pdf.save();
  }

  for (const group of groupCareRecordItemsByCategory(items)) {
    if (group.items.length === 0) {
      continue;
    }

    state = ensureSpace(pdf, state, SECTION_TITLE_SIZE + 20);
    state.page.drawText(getCareRecordCategoryTitle(group.id), {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: SECTION_TITLE_SIZE,
      font: boldFont,
      color: muted
    });
    state.y -= SECTION_TITLE_SIZE + 10;

    for (const item of group.items) {
      state = drawRecordItem(pdf, state, item, regularFont, boldFont, slate, muted);
    }

    state.y -= SECTION_GAP;
  }

  return pdf.save();
}

export function sanitizeLifeRecordsPdfFilename(value = "life-records") {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "life-records";
}

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getSectionBlocks, getVisibleSections } from "@/lib/summary-display";
import { formatSummaryGeneratedAt, getOverviewLines } from "@/lib/summary";
import { StructuredSummary, SummaryBlock } from "@/lib/types";

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
  color: ReturnType<typeof rgb>,
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
  color: ReturnType<typeof rgb>,
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
  color: ReturnType<typeof rgb>,
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

function drawSectionBlock(
  pdf: PDFDocument,
  state: PageState,
  block: SummaryBlock,
  regularFont: PDFFont,
  boldFont: PDFFont,
  slate: ReturnType<typeof rgb>,
  muted: ReturnType<typeof rgb>
) {
  let nextState = state;

  if (block.type === "bullets") {
    for (const item of block.items) {
      nextState = drawBulletItem(pdf, nextState, item, regularFont, slate);
    }

    return nextState;
  }

  if (block.type === "keyValue") {
    for (const row of block.rows) {
      nextState = drawBulletItem(
        pdf,
        nextState,
        `${row.label}: ${row.value}`,
        regularFont,
        slate
      );
    }

    return nextState;
  }

  if (block.type === "note") {
    nextState = drawParagraph(pdf, nextState, block.text, regularFont, BODY_SIZE, slate);
    return {
      ...nextState,
      y: nextState.y - ITEM_GAP
    };
  }

  for (const group of block.groups) {
    nextState = ensureSpace(pdf, nextState, BODY_SIZE + 10);
    nextState.page.drawText(group.label, {
      x: PAGE_MARGIN_X,
      y: nextState.y - BODY_SIZE,
      size: BODY_SIZE,
      font: boldFont,
      color: muted
    });
    nextState = {
      ...nextState,
      y: nextState.y - BODY_SIZE - 6
    };

    for (const item of group.items) {
      nextState = drawBulletItem(
        pdf,
        nextState,
        item,
        regularFont,
        slate,
        PAGE_MARGIN_X + 16,
        CONTENT_WIDTH - 16
      );
    }
  }

  return nextState;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function createSummaryPdf(summary: StructuredSummary) {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const slate = rgb(0.20, 0.27, 0.38);
  const muted = rgb(0.42, 0.49, 0.59);
  let state = createPage(pdf);

  state.page.drawText("Caregiver Handoff", {
    x: PAGE_MARGIN_X,
    y: state.y,
    size: SMALL_SIZE,
    font: boldFont,
    color: rgb(0.07, 0.50, 0.47)
  });
  state.y -= SMALL_SIZE + 10;

  state = drawParagraph(pdf, state, summary.title, boldFont, TITLE_SIZE, slate);
  state.y -= 8;

  const generatedAtText = formatSummaryGeneratedAt(summary.generatedAt, "english");
  if (generatedAtText) {
    state.page.drawText(`Summary created: ${generatedAtText}`, {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: SMALL_SIZE,
      font: regularFont,
      color: muted
    });
    state.y -= SMALL_SIZE + 12;
  }

  const overviewLines = getOverviewLines(summary.overview.trim());
  if (overviewLines.length > 0) {
    state.page.drawText("Overview", {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: SMALL_SIZE,
      font: boldFont,
      color: muted
    });
    state.y -= SMALL_SIZE + 8;
    for (const line of overviewLines) {
      state = drawBulletItem(pdf, state, line, regularFont, slate);
    }
    state.y -= SECTION_GAP;
  }

  for (const section of getVisibleSections(summary)) {
    const blocks = getSectionBlocks(section);

    state = ensureSpace(pdf, state, SECTION_TITLE_SIZE + 20);
    state.page.drawText(section.title.trim(), {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: SECTION_TITLE_SIZE,
      font: boldFont,
      color: muted
    });
    state.y -= SECTION_TITLE_SIZE + 10;

    if (section.intro?.trim()) {
      state = drawParagraph(pdf, state, section.intro.trim(), regularFont, BODY_SIZE, slate);
      state.y -= 8;
    }

    for (const block of blocks) {
      state = drawSectionBlock(pdf, state, block, regularFont, boldFont, slate, muted);
    }

    state.y -= SECTION_GAP;
  }

  return pdf.save();
}

export function buildSummaryEmailHtml(summary: StructuredSummary, editUrl?: string) {
  const generatedAtText = formatSummaryGeneratedAt(summary.generatedAt, "english");
  const overviewLines = getOverviewLines(summary.overview.trim());
  const sections = getVisibleSections(summary)
    .map((section) => {
      const intro = section.intro?.trim()
        ? `<p style="margin:0 0 10px;color:#334155;">${escapeHtml(section.intro.trim())}</p>`
        : "";
      const blocks = getSectionBlocks(section)
        .map((block) => {
          if (block.type === "bullets") {
            return `
              <ul style="margin:0 0 0 18px;padding:0;color:#334155;">
                ${block.items.map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`).join("")}
              </ul>
            `;
          }

          if (block.type === "keyValue") {
            return `
              <ul style="margin:0 0 0 18px;padding:0;color:#334155;">
                ${block.rows
                  .map(
                    (row) =>
                      `<li style="margin:0 0 6px;"><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</li>`
                  )
                  .join("")}
              </ul>
            `;
          }

          if (block.type === "note") {
            return `<p style="margin:0 0 10px;color:#334155;">${escapeHtml(block.text)}</p>`;
          }

          return block.groups
            .map(
              (group) => `
                <div style="margin:0 0 12px;">
                  <div style="font-weight:600;color:#64748b;margin:0 0 6px;">${escapeHtml(group.label)}</div>
                  <ul style="margin:0 0 0 18px;padding:0;color:#334155;">
                    ${group.items.map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`).join("")}
                  </ul>
                </div>
              `
            )
            .join("");
        })
        .join("");

      return `
        <h3 style="font-size:16px;margin:20px 0 8px;color:#334155;">${escapeHtml(section.title)}</h3>
        ${intro}
        ${blocks}
      `;
    })
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#334155;">
      <p style="margin:0 0 12px;">Attached is the caregiver handoff summary as a PDF.</p>
      ${
        editUrl
          ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(editUrl)}" style="color:#0f766e;font-weight:600;text-decoration:underline;">Open the app to review or edit this summary</a></p>`
          : ""
      }
      <p style="margin:0 0 16px;"><strong>${escapeHtml(summary.title)}</strong></p>
      ${
        generatedAtText
          ? `<p style="margin:0 0 12px;color:#64748b;"><strong>Summary created:</strong> ${escapeHtml(generatedAtText)}</p>`
          : ""
      }
      ${
        overviewLines.length > 0
          ? `<ul style="margin:0 0 16px 18px;padding:0;color:#334155;">${overviewLines
              .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${sections}
    </div>
  `;
}

export function sanitizePdfFilename(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "caregiver-handoff-summary";
}

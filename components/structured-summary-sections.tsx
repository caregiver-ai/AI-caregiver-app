"use client";

import { deriveItemsFromBlocks } from "@/lib/summary-structured";
import { getSectionBlocks, sectionHasContent } from "@/lib/summary-display";
import { SummaryBlock, SummarySection } from "@/lib/types";

function itemsToTextarea(items: string[]) {
  return items.join("\n");
}

function textareaToItems(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function updateBlocks(section: SummarySection, blocks: SummaryBlock[], onChange: (section: SummarySection) => void) {
  onChange({
    ...section,
    blocks,
    items: deriveItemsFromBlocks(blocks)
  });
}

function BlockEditor({
  block,
  blockIndex,
  section,
  onChange
}: {
  block: SummaryBlock;
  blockIndex: number;
  section: SummarySection;
  onChange: (section: SummarySection) => void;
}) {
  const blocks = getSectionBlocks(section);

  if (block.type === "bullets") {
    return (
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">
          {blocks.length > 1 ? `Bullet list ${blockIndex + 1}` : "Bullets"}
        </span>
        <textarea
          className="min-h-28 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
          value={itemsToTextarea(block.items)}
          onChange={(event) => {
            const nextBlocks = [...blocks];
            nextBlocks[blockIndex] = {
              ...block,
              items: textareaToItems(event.target.value)
            };
            updateBlocks(section, nextBlocks, onChange);
          }}
        />
      </label>
    );
  }

  if (block.type === "note") {
    return (
      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Note</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
          value={block.text}
          onChange={(event) => {
            const nextBlocks = [...blocks];
            nextBlocks[blockIndex] = {
              ...block,
              text: event.target.value
            };
            updateBlocks(section, nextBlocks, onChange);
          }}
        />
      </label>
    );
  }

  if (block.type === "keyValue") {
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-700">Summary rows</div>
        {block.rows.map((row, rowIndex) => (
          <label key={`${row.label}-${rowIndex}`} className="block space-y-2">
            <span className="text-sm font-medium text-slate-600">{row.label}</span>
            <input
              className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
              value={row.value}
              onChange={(event) => {
                const nextBlocks = [...blocks];
                nextBlocks[blockIndex] = {
                  ...block,
                  rows: block.rows.map((entry, entryIndex) =>
                    entryIndex === rowIndex
                      ? {
                          ...entry,
                          value: event.target.value
                        }
                      : entry
                  )
                };
                updateBlocks(section, nextBlocks, onChange);
              }}
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {block.groups.map((group, groupIndex) => (
        <label key={`${group.label}-${groupIndex}`} className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">{group.label}</span>
          <textarea
            className="min-h-24 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
            value={itemsToTextarea(group.items)}
            onChange={(event) => {
              const nextBlocks = [...blocks];
              nextBlocks[blockIndex] = {
                ...block,
                groups: block.groups.map((entry, entryIndex) =>
                  entryIndex === groupIndex
                    ? {
                        ...entry,
                        items: textareaToItems(event.target.value)
                      }
                    : entry
                )
              };
              updateBlocks(section, nextBlocks, onChange);
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function StructuredSummarySectionEditor({
  section,
  onChange
}: {
  section: SummarySection;
  onChange: (section: SummarySection) => void;
}) {
  const blocks = getSectionBlocks(section);

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-canvas px-4 py-4">
      <div className="space-y-1">
        <span className="text-sm font-medium text-slate-700">Section title</span>
        <div className="rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-slate-700">
          {section.title}
        </div>
      </div>

      {typeof section.intro === "string" ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Intro</span>
          <textarea
            className="min-h-20 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
            value={section.intro}
            onChange={(event) =>
              onChange({
                ...section,
                intro: event.target.value
              })
            }
          />
        </label>
      ) : null}

      {blocks.map((block, blockIndex) => (
        <BlockEditor
          key={`${section.id}-block-${blockIndex}`}
          block={block}
          blockIndex={blockIndex}
          section={section}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function SummaryBlockDisplay({ block }: { block: SummaryBlock }) {
  if (block.type === "bullets") {
    return (
      <ul className="space-y-2 text-sm leading-6 text-slate-700">
        {block.items.map((item) => (
          <li key={item} className="rounded-2xl bg-canvas px-4 py-3">
            {item}
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "note") {
    return <p className="text-sm leading-6 text-slate-700">{block.text}</p>;
  }

  if (block.type === "keyValue") {
    return (
      <ul className="space-y-2 text-sm leading-6 text-slate-700">
        {block.rows.map((row) => (
          <li key={`${row.label}-${row.value}`} className="rounded-2xl bg-canvas px-4 py-3">
            <span className="font-semibold text-ink">{row.label}: </span>
            <span>{row.value}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      {block.groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-600">{group.label}</h3>
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {group.items.map((item) => (
              <li key={`${group.label}-${item}`} className="rounded-2xl bg-canvas px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function StructuredSummarySectionDisplay({ section }: { section: SummarySection }) {
  if (!sectionHasContent(section)) {
    return null;
  }

  const blocks = getSectionBlocks(section);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{section.title}</h2>
      {section.intro ? <p className="text-sm leading-6 text-slate-700">{section.intro}</p> : null}
      <div className="space-y-3">
        {blocks.map((block, blockIndex) => (
          <SummaryBlockDisplay key={`${section.id}-${block.type}-${blockIndex}`} block={block} />
        ))}
      </div>
    </div>
  );
}

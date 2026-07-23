"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import {
  CARE_RECORD_CATEGORY_DEFINITIONS,
  CareRecordCategory,
  CareRecordField,
  CareRecordItem,
  CareRecordSourceType,
  CareRecordSuggestion,
  getCareRecordCategoryTitle,
  groupCareRecordItemsByCategory
} from "@/lib/care-records";
import { authenticatedFetch, getCurrentAuthUser } from "@/lib/draft-api";

type EditableRecord = Omit<CareRecordSuggestion, "tempId">;
interface PrintableCareRecord {
  id: string;
  category: CareRecordCategory;
  title: string;
  fields: CareRecordField[];
  notes: string;
  sourceType: CareRecordSourceType;
  sourceLabel: string;
  printOnly?: boolean;
}

const EMPTY_RECORD: EditableRecord = {
  category: "important_people",
  title: "",
  fields: [],
  notes: "",
  sourceType: "typed",
  sourceLabel: "Caregiver entry"
};

function emptyField(): CareRecordField {
  return { label: "", value: "" };
}

function hasRecordContent(record: EditableRecord) {
  return (
    record.notes.trim().length > 0 ||
    record.fields.some((field) => field.label.trim() && field.value.trim())
  );
}

function compactRecord(record: EditableRecord): EditableRecord {
  return {
    ...record,
    title: record.title.trim() || "Care record",
    notes: record.notes.trim(),
    sourceLabel: record.sourceLabel.trim() || "Caregiver entry",
    fields: record.fields
      .map((field) => ({
        label: field.label.trim(),
        value: field.value.trim()
      }))
      .filter((field) => field.label && field.value)
  };
}

function createPrintOnlyRecord(record: EditableRecord): PrintableCareRecord {
  return {
    id: `print-only-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...record,
    printOnly: true
  };
}

function RecordForm({
  record,
  saveLabel,
  onChange,
  onSave,
  onCancel,
  disabled
}: {
  record: EditableRecord;
  saveLabel: string;
  onChange: (record: EditableRecord) => void;
  onSave: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  function updateField(index: number, field: CareRecordField) {
    onChange({
      ...record,
      fields: record.fields.map((entry, entryIndex) => (entryIndex === index ? field : entry))
    });
  }

  function removeField(index: number) {
    onChange({
      ...record,
      fields: record.fields.filter((_, entryIndex) => entryIndex !== index)
    });
  }

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-canvas px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Title</span>
          <input
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
            value={record.title}
            onChange={(event) => onChange({ ...record, title: event.target.value })}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Category</span>
          <select
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-accent"
            value={record.category}
            onChange={(event) =>
              onChange({ ...record, category: event.target.value as CareRecordCategory })
            }
          >
            {CARE_RECORD_CATEGORY_DEFINITIONS.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700">Details</h3>
          <button
            className="rounded-2xl border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={() => onChange({ ...record, fields: [...record.fields, emptyField()] })}
          >
            Add detail
          </button>
        </div>
        {record.fields.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-white px-4 py-3 text-sm text-slate-500">
            Add at least one complete detail or note before adding.
          </p>
        ) : null}
        {record.fields.map((field, index) => (
          <div
            key={`${index}-${field.label}`}
            className="space-y-3 rounded-2xl border border-border bg-white px-3 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Detail {index + 1}
              </p>
              <button
                className="rounded-2xl border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                type="button"
                onClick={() => removeField(index)}
              >
                Remove
              </button>
            </div>
            <label className="block space-y-2">
              <span className="text-xs font-semibold text-slate-600">Label</span>
              <input
                className="w-full rounded-2xl border border-border bg-canvas px-3 py-2 text-sm outline-none transition focus:border-accent"
                placeholder="Example: Phone/Text"
                value={field.label}
                onChange={(event) => updateField(index, { ...field, label: event.target.value })}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-semibold text-slate-600">Value</span>
              <textarea
                className="min-h-16 w-full resize-y rounded-2xl border border-border bg-canvas px-3 py-2 text-sm leading-6 outline-none transition focus:border-accent"
                placeholder="Example: 781-555-0142"
                value={field.value}
                onChange={(event) => updateField(index, { ...field, value: event.target.value })}
              />
            </label>
          </div>
        ))}
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-slate-700">Notes</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
          value={record.notes}
          onChange={(event) => onChange({ ...record, notes: event.target.value })}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Source type</span>
          <select
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-accent"
            value={record.sourceType}
            onChange={(event) =>
              onChange({
                ...record,
                sourceType: event.target.value as EditableRecord["sourceType"]
              })
            }
          >
            <option value="typed">Typed</option>
            <option value="image">Image</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Source label</span>
          <input
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
            value={record.sourceLabel}
            onChange={(event) => onChange({ ...record, sourceLabel: event.target.value })}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <button
            className="rounded-2xl border border-border bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            disabled={disabled}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || !hasRecordContent(record)}
          type="button"
          onClick={onSave}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

function RecordCard({
  item,
  editing,
  saving,
  onEdit,
  onDelete,
  onCancelEdit,
  onChangeEdit,
  onSaveEdit
}: {
  item: CareRecordItem;
  editing: EditableRecord | null;
  saving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCancelEdit: () => void;
  onChangeEdit: (record: EditableRecord) => void;
  onSaveEdit: () => void;
}) {
  if (editing) {
    return (
      <RecordForm
        disabled={saving}
        record={editing}
        saveLabel={saving ? "Saving..." : "Save changes"}
        onCancel={onCancelEdit}
        onChange={onChangeEdit}
        onSave={onSaveEdit}
      />
    );
  }

  return (
    <article className="space-y-3 rounded-3xl border border-border bg-white px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">{item.title}</h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {getCareRecordCategoryTitle(item.category)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-2xl border border-border px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-canvas"
            type="button"
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="rounded-2xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
            disabled={saving}
            type="button"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>

      {item.fields.length > 0 ? (
        <dl className="space-y-2 text-sm leading-6 text-slate-700">
          {item.fields.map((field) => (
            <div key={`${item.id}-${field.label}-${field.value}`} className="rounded-2xl bg-canvas px-4 py-3">
              <dt className="font-semibold text-ink">{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.notes ? <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-700">{item.notes}</p> : null}
      <p className="text-xs text-slate-500">
        Source: {item.sourceLabel} ({item.sourceType})
      </p>
    </article>
  );
}

function PrintableRecordCard({ item }: { item: PrintableCareRecord }) {
  return (
    <article className="print-avoid-break space-y-3 rounded-2xl border border-border bg-white px-4 py-4">
      <div>
        <h4 className="text-base font-semibold text-ink">{item.title}</h4>
        <p className="mt-1 text-xs text-slate-500">
          Source: {item.sourceLabel} ({item.sourceType})
          {item.printOnly ? <span className="print-hidden"> - Not saved for future editing</span> : null}
        </p>
      </div>
      {item.fields.length > 0 ? (
        <dl className="space-y-2 text-sm leading-6 text-slate-700">
          {item.fields.map((field) => (
            <div key={`${item.id}-${field.label}-${field.value}`} className="rounded-2xl bg-canvas px-4 py-3">
              <dt className="font-semibold text-ink">{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.notes ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-700">
          {item.notes}
        </p>
      ) : null}
    </article>
  );
}

function PrintableCareRecordsDocument({ items }: { items: PrintableCareRecord[] }) {
  const groupedRecords = groupCareRecordItemsByCategory(items);
  const printOnlyCount = items.filter((item) => item.printOnly).length;

  return (
    <section className="print-document space-y-5 rounded-3xl border border-border bg-white px-4 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-ink">Care Records</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Legal, health care, financial, support, and administrative records for trusted handoff.
          </p>
        </div>
        <button
          className="print-hidden rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={items.length === 0}
          type="button"
          onClick={() => window.print()}
        >
          Print / Save PDF
        </button>
      </div>

      <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-700">
        Uploaded files are used only for extraction and are not stored.
      </p>

      {printOnlyCount > 0 ? (
        <p className="print-hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          {printOnlyCount} {printOnlyCount === 1 ? "record is" : "records are"} included for this printout
          only and will disappear after reload.
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-600">
          No Care Records are ready to print yet.
        </p>
      ) : (
        groupedRecords.map((group) =>
          group.items.length > 0 ? (
            <div key={group.id} className="print-avoid-break space-y-3">
              <h3 className="border-b border-border pb-2 text-sm font-semibold uppercase text-slate-600">
                {group.title}
              </h3>
              {group.items.map((item) => (
                <PrintableRecordCard key={item.id} item={item} />
              ))}
            </div>
          ) : null
        )
      )}
    </section>
  );
}

function toEditableRecord(record: CareRecordSuggestion | CareRecordItem): EditableRecord {
  return {
    category: record.category,
    title: record.title,
    fields: record.fields.length > 0 ? record.fields : [emptyField()],
    notes: record.notes,
    sourceType: record.sourceType,
    sourceLabel: record.sourceLabel
  };
}

export function CareRecordsWorkspace() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<CareRecordItem[]>([]);
  const [suggestions, setSuggestions] = useState<CareRecordSuggestion[]>([]);
  const [printOnlyItems, setPrintOnlyItems] = useState<PrintableCareRecord[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saveForFutureEditing, setSaveForFutureEditing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editingRecord, setEditingRecord] = useState<EditableRecord | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const groupedItems = useMemo(() => groupCareRecordItemsByCategory(items), [items]);
  const printableItems = useMemo<PrintableCareRecord[]>(
    () => [...items, ...printOnlyItems],
    [items, printOnlyItems]
  );

  function clearSourceInputs() {
    setText("");
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeSuggestion(tempId: string) {
    setSuggestions((current) => current.filter((suggestion) => suggestion.tempId !== tempId));
    if (suggestions.length <= 1) {
      clearSourceInputs();
    }
  }

  async function loadWorkspace() {
    setLoading(true);
    setError("");

    try {
      const user = await getCurrentAuthUser();
      if (!user?.email) {
        router.replace("/");
        return;
      }

      const response = await authenticatedFetch("/api/care-records", {
        method: "GET"
      });
      const data = (await response.json()) as {
        items?: CareRecordItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load Care Records.");
      }

      setItems(data.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Care Records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function handleExtract() {
    if (!text.trim() && !file) {
      setError("Add text or upload an image/PDF first.");
      setStatus("");
      return;
    }

    setExtracting(true);
    setError("");
    setStatus("");

    try {
      const formData = new FormData();
      formData.append("text", text);
      if (file) {
        formData.append("file", file);
      }

      const response = await authenticatedFetch("/api/care-records/extract", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as {
        suggestions?: CareRecordSuggestion[];
        extractionMode?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to extract records.");
      }

      setSuggestions(data.suggestions ?? []);
      setStatus(
        data.suggestions?.length
          ? "Review the suggested records below before adding them."
          : "No structured records were found. Try adding more detail."
      );
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Unable to extract records.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSaveSuggestion(tempId: string, record: EditableRecord) {
    const compacted = compactRecord(record);
    if (!hasRecordContent(compacted)) {
      setError("Review the record before adding it.");
      return;
    }

    setError("");
    setStatus("");

    if (!saveForFutureEditing) {
      setPrintOnlyItems((current) => [createPrintOnlyRecord(compacted), ...current]);
      removeSuggestion(tempId);
      setStatus("Care Record added to the printable document. It was not saved for future editing.");
      return;
    }

    setSaving(true);

    try {
      const response = await authenticatedFetch("/api/care-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [compacted] })
      });
      const data = (await response.json()) as {
        items?: CareRecordItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save Care Record.");
      }

      setItems(data.items ?? []);
      removeSuggestion(tempId);
      setStatus("Care Record saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save Care Record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !editingRecord) {
      return;
    }

    const compacted = compactRecord(editingRecord);
    setSaving(true);
    setError("");
    setStatus("");

    try {
      const response = await authenticatedFetch(`/api/care-records/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: compacted })
      });
      const data = (await response.json()) as {
        item?: CareRecordItem;
        error?: string;
      };

      if (!response.ok || !data.item) {
        throw new Error(data.error ?? "Unable to update Care Record.");
      }

      setItems((current) => current.map((item) => (item.id === data.item?.id ? data.item : item)));
      setEditingId("");
      setEditingRecord(null);
      setStatus("Care Record updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update Care Record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(itemId: string) {
    setSaving(true);
    setError("");
    setStatus("");

    try {
      const response = await authenticatedFetch(`/api/care-records/${itemId}`, {
        method: "DELETE"
      });
      const data = (await response.json()) as {
        items?: CareRecordItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to delete Care Record.");
      }

      setItems(data.items ?? []);
      setStatus("Care Record deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete Care Record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Care Records"
      subtitle="Type information or upload one image/PDF, including iPhone HEIC photos. AI suggests records, and you choose whether approved details are saved for future editing."
    >
      <div className="space-y-6">
        <div className="print-hidden flex flex-col gap-2 sm:flex-row">
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-canvas"
            href="/"
          >
            Dashboard
          </Link>
        </div>

        {error ? (
          <div className="print-hidden">
            <StatusBanner tone="error">{error}</StatusBanner>
          </div>
        ) : null}
        {!error && status ? (
          <div className="print-hidden">
            <StatusBanner tone="success">{status}</StatusBanner>
          </div>
        ) : null}

        <section className="print-hidden space-y-4 rounded-3xl border border-border bg-canvas px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Add Records
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Original uploads are used for extraction during this request and are not saved.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Typed or pasted information</span>
            <textarea
              className="min-h-36 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
              placeholder="Example: Dr. Patel at City Dental, phone 555-0142, call for dental emergencies..."
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Upload image or PDF</span>
            <input
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
              className="block w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-accentSoft file:px-3 file:py-2 file:text-sm file:font-semibold file:text-accent"
              ref={fileInputRef}
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="text-xs text-slate-500">
                Selected: {file.name} ({Math.ceil(file.size / 1024)} KB)
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Supports PDF, PNG, JPG, WebP, HEIC, and HEIF.
              </p>
            )}
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-border bg-white px-4 py-3">
            <input
              checked={saveForFutureEditing}
              className="mt-1 h-4 w-4 accent-teal-700"
              type="checkbox"
              onChange={(event) => setSaveForFutureEditing(event.target.checked)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-semibold text-ink">
                Save approved records for future editing
              </span>
              <span className="block text-sm leading-6 text-slate-600">
                If unchecked, approved records are added only to the printable Care Records document.
              </span>
            </span>
          </label>

          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={extracting || loading}
            type="button"
            onClick={() => void handleExtract()}
          >
            {extracting ? "Organizing..." : "Organize with AI"}
          </button>
        </section>

        {suggestions.length > 0 ? (
          <section className="print-hidden space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Review Before Saving
            </h2>
            {suggestions.map((suggestion) => (
              <RecordForm
                key={suggestion.tempId}
                disabled={saving}
                record={toEditableRecord(suggestion)}
                saveLabel={
                  saving
                    ? "Saving..."
                    : saveForFutureEditing
                      ? "Save reviewed record"
                      : "Add to printable document"
                }
                onCancel={() =>
                  setSuggestions((current) =>
                    current.filter((entry) => entry.tempId !== suggestion.tempId)
                  )
                }
                onChange={(nextRecord) =>
                  setSuggestions((current) =>
                    current.map((entry) =>
                      entry.tempId === suggestion.tempId ? { ...entry, ...nextRecord } : entry
                    )
                  )
                }
                onSave={() => void handleSaveSuggestion(suggestion.tempId, toEditableRecord(suggestion))}
              />
            ))}
          </section>
        ) : null}

        <section className="print-hidden space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Saved Records
          </h2>
          {loading ? (
            <p className="rounded-2xl bg-canvas px-4 py-3 text-sm text-slate-600">Loading records...</p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-600">
              No Care Records have been saved yet.
            </p>
          ) : (
            groupedItems.map((group) =>
              group.items.length > 0 ? (
                <div key={group.id} className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-600">{group.title}</h3>
                  {group.items.map((item) => (
                    <RecordCard
                      key={item.id}
                      editing={editingId === item.id ? editingRecord : null}
                      item={item}
                      saving={saving}
                      onCancelEdit={() => {
                        setEditingId("");
                        setEditingRecord(null);
                      }}
                      onChangeEdit={setEditingRecord}
                      onDelete={() => void handleDelete(item.id)}
                      onEdit={() => {
                        setEditingId(item.id);
                        setEditingRecord(toEditableRecord(item));
                      }}
                      onSaveEdit={() => void handleSaveEdit()}
                    />
                  ))}
                </div>
              ) : null
            )
          )}
        </section>

        <PrintableCareRecordsDocument items={printableItems} />
      </div>
    </AppShell>
  );
}

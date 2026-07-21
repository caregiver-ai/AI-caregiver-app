"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaregiverInsightsDisplay,
  StructuredSummarySectionDisplay
} from "@/components/structured-summary-sections";
import { StatusBanner } from "@/components/status-banner";
import { APP_NAME } from "@/lib/constants";
import { CareRecordItem, groupCareRecordItemsByCategory } from "@/lib/care-records";
import { authenticatedFetch, getCurrentAuthUser } from "@/lib/draft-api";
import {
  getSummarySectionDisplayTitle,
  getVisibleAboutSection,
  getVisibleDetailSections
} from "@/lib/summary-display";
import { formatSummaryGeneratedAt, getOverviewLines } from "@/lib/summary";
import { StructuredSummary } from "@/lib/types";

type HandoffResponse = {
  knowMyLovedOne: {
    sessionId: string;
    status: string;
    updatedAt: string;
    summary: StructuredSummary;
  } | null;
  careRecords: CareRecordItem[];
  error?: string;
};

function CareRecordDisplay({ item }: { item: CareRecordItem }) {
  return (
    <article className="space-y-3 rounded-3xl border border-border bg-white px-4 py-4">
      <div>
        <h3 className="text-base font-semibold text-ink">{item.title}</h3>
        <p className="mt-1 text-xs text-slate-500">
          Source: {item.sourceLabel} ({item.sourceType})
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

export function HandoffView() {
  const router = useRouter();
  const [summary, setSummary] = useState<StructuredSummary | null>(null);
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState("");
  const [careRecords, setCareRecords] = useState<CareRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const groupedRecords = useMemo(() => groupCareRecordItemsByCategory(careRecords), [careRecords]);
  const overviewLines = useMemo(() => getOverviewLines(summary?.overview ?? ""), [summary?.overview]);
  const generatedAtText = useMemo(
    () => formatSummaryGeneratedAt(summary?.generatedAt ?? "", "english"),
    [summary?.generatedAt]
  );
  const aboutSection = summary ? getVisibleAboutSection(summary) : null;
  const detailSections = summary ? getVisibleDetailSections(summary) : [];

  useEffect(() => {
    let active = true;

    async function loadHandoff() {
      setLoading(true);
      setError("");

      try {
        const user = await getCurrentAuthUser();
        if (!active) {
          return;
        }

        if (!user?.email) {
          router.replace("/");
          return;
        }

        const response = await authenticatedFetch("/api/handoff", {
          method: "GET"
        });
        const data = (await response.json()) as HandoffResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load Complete Handoff.");
        }

        setSummary(data.knowMyLovedOne?.summary ?? null);
        setSummaryUpdatedAt(data.knowMyLovedOne?.updatedAt ?? "");
        setCareRecords(data.careRecords ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load Complete Handoff.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadHandoff();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <Link
          className="text-sm font-medium uppercase tracking-[0.25em] text-accent transition hover:text-teal-700"
          href="/"
        >
          {APP_NAME}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold text-ink">Complete Handoff</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The caregiver guide and Care Records stay separate here so overlap is easy to review.
        </p>
      </div>

      <div className="space-y-6 rounded-[28px] border border-border bg-white/90 p-5 shadow-card backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-canvas"
            href="/know-my-loved-one"
          >
            Know My Loved One
          </Link>
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-canvas"
            href="/care-records"
          >
            Care Records
          </Link>
        </div>

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        {loading ? (
          <p className="rounded-2xl bg-canvas px-4 py-3 text-sm text-slate-600">
            Loading handoff...
          </p>
        ) : (
          <>
            <section className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Know My Loved One
                </h2>
                {summary ? (
                  <div className="space-y-1">
                    <h3 className="text-2xl font-semibold leading-9 text-ink">{summary.title}</h3>
                    {generatedAtText ? (
                      <p className="text-xs text-slate-500">Generated {generatedAtText}</p>
                    ) : summaryUpdatedAt ? (
                      <p className="text-xs text-slate-500">
                        Updated {new Date(summaryUpdatedAt).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-600">
                    No caregiver guide is available yet.
                  </div>
                )}
              </div>

              {summary ? (
                <div className="space-y-5">
                  {aboutSection ? (
                    <StructuredSummarySectionDisplay
                      displayTitle={getSummarySectionDisplayTitle(summary, aboutSection)}
                      section={aboutSection}
                    />
                  ) : null}

                  {overviewLines.length > 0 ? (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Overview
                      </h3>
                      <ul className="space-y-2 text-sm leading-6 text-slate-700">
                        {overviewLines.map((line) => (
                          <li key={line} className="rounded-2xl bg-canvas px-4 py-3">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <CaregiverInsightsDisplay
                    insights={summary.caregiverInsights ?? []}
                    title="Caregiver Insights"
                  />

                  {detailSections.map((section) => (
                    <StructuredSummarySectionDisplay
                      key={section.id}
                      displayTitle={getSummarySectionDisplayTitle(summary, section)}
                      section={section}
                    />
                  ))}
                </div>
              ) : null}
            </section>

            <section className="space-y-5 border-t border-border pt-6">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Care Records
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  Approved records and document details saved by the caregiver.
                </p>
              </div>

              {careRecords.length === 0 ? (
                <div className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-slate-600">
                  No Care Records have been saved yet.
                </div>
              ) : (
                groupedRecords.map((group) =>
                  group.items.length > 0 ? (
                    <div key={group.id} className="space-y-3">
                      <h3 className="text-sm font-semibold text-slate-600">{group.title}</h3>
                      {group.items.map((item) => (
                        <CareRecordDisplay key={item.id} item={item} />
                      ))}
                    </div>
                  ) : null
                )
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

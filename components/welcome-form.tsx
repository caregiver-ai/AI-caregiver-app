"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { APP_NAME } from "@/lib/constants";
import { UI_LANGUAGE_OPTIONS, getWelcomeCopy } from "@/lib/localization";
import { saveDraft } from "@/lib/storage";
import { SessionIntakeDetails, UiLanguage } from "@/lib/types";

function FieldLabel({
  children,
  optional = false,
  optionalLabel
}: {
  children: string;
  optional?: boolean;
  optionalLabel: string;
}) {
  return (
    <span className="text-sm font-medium text-slate-700">
      {children}
      {optional ? <span className="font-normal text-slate-500"> ({optionalLabel})</span> : null}
    </span>
  );
}

export function WelcomeForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [intakeDetails, setIntakeDetails] = useState<SessionIntakeDetails>({
    caregiverName: "",
    caregiverAge: "",
    caregiverPhone: "",
    careRecipientName: "",
    careRecipientAge: "",
    preferredLanguage: "english"
  });
  const uiLanguage = intakeDetails.preferredLanguage;
  const copy = useMemo(() => getWelcomeCopy(uiLanguage), [uiLanguage]);

  function updateField<Field extends keyof SessionIntakeDetails>(
    field: Field,
    value: SessionIntakeDetails[Field]
  ) {
    setIntakeDetails((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleStart() {
    if (!intakeDetails.caregiverName.trim()) {
      setError(copy.errors.caregiverName);
      return;
    }

    if (!intakeDetails.careRecipientName.trim()) {
      setError(copy.errors.careRecipientName);
      return;
    }

    if (!intakeDetails.careRecipientAge.trim()) {
      setError(copy.errors.careRecipientAge);
      return;
    }

    if (!email.trim()) {
      setError(copy.errors.email);
      return;
    }

    if (!consented) {
      setError(copy.errors.consent);
      return;
    }

    setLoading(true);
    setError("");

    const payload = {
      email: email.trim(),
      consented,
      ...intakeDetails
    };

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Unable to start the session.");
      }

      const data = (await response.json()) as { sessionId: string };

      saveDraft({
        sessionId: data.sessionId,
        email: email.trim(),
        consented,
        intakeDetails,
        turns: []
      });

      router.push("/reflection");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errors.startFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8 sm:px-6">
      <section className="w-full rounded-[32px] border border-border bg-white/95 p-6 shadow-card sm:p-8">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-accent">{APP_NAME}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{copy.title}</h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                {copy.subtitle}
              </p>
            </div>
            <label className="block sm:w-56">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {copy.languageLabel}
              </span>
              <select
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-accent"
                value={uiLanguage}
                onChange={(event) =>
                  updateField("preferredLanguage", event.target.value as UiLanguage)
                }
              >
                {UI_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              {copy.aboutYou}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel optionalLabel={copy.optional}>{copy.yourName}</FieldLabel>
                <input
                  autoComplete="name"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.placeholders.caregiverName}
                  type="text"
                  value={intakeDetails.caregiverName}
                  onChange={(event) => updateField("caregiverName", event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel optional optionalLabel={copy.optional}>
                  {copy.yourAge}
                </FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  inputMode="numeric"
                  min="0"
                  placeholder={copy.placeholders.caregiverAge}
                  type="number"
                  value={intakeDetails.caregiverAge}
                  onChange={(event) => updateField("caregiverAge", event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              {copy.aboutSupportedPerson}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel optionalLabel={copy.optional}>{copy.theirName}</FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.placeholders.careRecipientName}
                  type="text"
                  value={intakeDetails.careRecipientName}
                  onChange={(event) => updateField("careRecipientName", event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel optionalLabel={copy.optional}>{copy.theirAge}</FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  inputMode="numeric"
                  min="0"
                  placeholder={copy.placeholders.careRecipientAge}
                  type="number"
                  value={intakeDetails.careRecipientAge}
                  onChange={(event) => updateField("careRecipientAge", event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              {copy.reachYou}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel optionalLabel={copy.optional}>{copy.emailAddress}</FieldLabel>
                <input
                  autoComplete="email"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.placeholders.email}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel optional optionalLabel={copy.optional}>
                  {copy.phoneNumber}
                </FieldLabel>
                <input
                  autoComplete="tel"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.placeholders.caregiverPhone}
                  type="tel"
                  value={intakeDetails.caregiverPhone}
                  onChange={(event) => updateField("caregiverPhone", event.target.value)}
                />
              </label>
            </div>
          </section>

          <label className="flex items-start gap-3 rounded-2xl border border-border px-4 py-4">
            <input
              checked={consented}
              className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
              type="checkbox"
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span className="text-sm leading-6 text-slate-700">{copy.consent}</span>
          </label>

          {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            type="button"
            onClick={handleStart}
          >
            {loading ? copy.startingLabel : copy.continueLabel}
          </button>
        </div>
      </section>
    </main>
  );
}

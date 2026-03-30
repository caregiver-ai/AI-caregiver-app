"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { APP_NAME } from "@/lib/constants";
import { saveDraft } from "@/lib/storage";
import { SessionIntakeDetails } from "@/lib/types";

function FieldLabel({
  children,
  optional = false
}: {
  children: string;
  optional?: boolean;
}) {
  return (
    <span className="text-sm font-medium text-slate-700">
      {children}
      {optional ? <span className="font-normal text-slate-500"> (optional)</span> : null}
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
    careRecipientAge: ""
  });

  function updateField(field: keyof SessionIntakeDetails, value: string) {
    setIntakeDetails((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleStart() {
    if (!intakeDetails.caregiverName.trim()) {
      setError("Enter your name to start.");
      return;
    }

    if (!intakeDetails.careRecipientName.trim()) {
      setError("Enter the name of the person you support.");
      return;
    }

    if (!intakeDetails.careRecipientAge.trim()) {
      setError("Enter the age of the person you support.");
      return;
    }

    if (!email.trim()) {
      setError("Enter an email address so we can connect this session to you.");
      return;
    }

    if (!consented) {
      setError("Consent is required before starting.");
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
      setError(requestError instanceof Error ? requestError.message : "Unable to start the intake.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8 sm:px-6">
      <section className="w-full rounded-[32px] border border-border bg-white/95 p-6 shadow-card sm:p-8">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-accent">{APP_NAME}</p>
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">
            Let's start with a few basics.
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            We'll use these details to personalize this for you.
          </p>
        </div>

        <div className="mt-8 space-y-8">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              About you
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel>Your name</FieldLabel>
                <input
                  autoComplete="name"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder="Your name"
                  type="text"
                  value={intakeDetails.caregiverName}
                  onChange={(event) => updateField("caregiverName", event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel optional>Your age</FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  inputMode="numeric"
                  min="0"
                  placeholder="Age"
                  type="number"
                  value={intakeDetails.caregiverAge}
                  onChange={(event) => updateField("caregiverAge", event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              About the person you support
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel>Their name</FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder="Their name"
                  type="text"
                  value={intakeDetails.careRecipientName}
                  onChange={(event) => updateField("careRecipientName", event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel>Their age</FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  inputMode="numeric"
                  min="0"
                  placeholder="Age"
                  type="number"
                  value={intakeDetails.careRecipientAge}
                  onChange={(event) => updateField("careRecipientAge", event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              How we can reach you
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel>Email address</FieldLabel>
                <input
                  autoComplete="email"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder="caregiver@example.com"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel optional>Phone number</FieldLabel>
                <input
                  autoComplete="tel"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder="(555) 555-5555"
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
            <span className="text-sm leading-6 text-slate-700">
              I consent to entering caregiving information for transcript generation, summary
              creation, and storage.
            </span>
          </label>

          {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            type="button"
            onClick={handleStart}
          >
            {loading ? "Starting..." : "Continue"}
          </button>
        </div>
      </section>
    </main>
  );
}

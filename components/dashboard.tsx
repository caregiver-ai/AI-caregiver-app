"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusBanner } from "@/components/status-banner";
import type { CareRecordItem } from "@/lib/care-records";
import { APP_NAME, STORAGE_KEY } from "@/lib/constants";
import type { SessionDraft } from "@/lib/types";

type AuthMode = "signin" | "signup";

function hasValidOptionalDate(value: string) {
  if (!value) {
    return true;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIntakeReadyForReflection(draft: Pick<SessionDraft, "intakeDetails" | "consented">) {
  const { intakeDetails, consented } = draft;

  return (
    consented &&
    intakeDetails.caregiverFirstName.trim().length > 0 &&
    intakeDetails.caregiverLastName.trim().length > 0 &&
    Boolean(intakeDetails.caregiver55OrOlder) &&
    intakeDetails.careRecipientFirstName.trim().length > 0 &&
    intakeDetails.careRecipientLastName.trim().length > 0 &&
    hasValidOptionalDate(intakeDetails.careRecipientDateOfBirth)
  );
}

function getKnowMyLovedOnePath(draft: SessionDraft | null) {
  if (!draft) {
    return "/know-my-loved-one";
  }

  if (draft.structuredSummary) {
    return "/review";
  }

  if (isIntakeReadyForReflection(draft)) {
    return "/reflection";
  }

  return "/know-my-loved-one";
}

function getKnowMyLovedOneStatus(draft: SessionDraft | null) {
  if (!draft) {
    return "Not started";
  }

  if (draft.editedSummary) {
    return "Summary completed";
  }

  if (draft.structuredSummary) {
    return "Ready to review";
  }

  if (draft.turns.some((turn) => turn.role === "user" && turn.content.trim())) {
    return "Questions in progress";
  }

  if (isIntakeReadyForReflection(draft)) {
    return "Ready for questions";
  }

  return "Profile started";
}

function isEmailNotConfirmedError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("email not confirmed");
}

function loadDashboardDraft(): SessionDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionDraft;
  } catch {
    return null;
  }
}

function saveDashboardDraft(draft: SessionDraft) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

function clearDashboardDraft() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

async function getDraftApi() {
  return import("@/lib/draft-api");
}

async function getSupabaseClient() {
  const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
  return getSupabaseBrowserClient();
}

export function Dashboard() {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [careRecords, setCareRecords] = useState<CareRecordItem[]>([]);
  const knowPath = useMemo(() => getKnowMyLovedOnePath(draft), [draft]);
  const knowStatus = useMemo(() => getKnowMyLovedOneStatus(draft), [draft]);
  const careRecordsStatus =
    careRecords.length > 0
      ? `${careRecords.length} approved ${careRecords.length === 1 ? "record" : "records"}`
      : "Not started";

  async function loadDashboardData(userEmail: string) {
    setLoadingData(true);
    setAuthenticated(true);
    setEmail(userEmail);
    setError("");
    setNotice("");

    const localDraft = loadDashboardDraft();
    if (localDraft?.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
      clearDashboardDraft();
    }

    try {
      const { authenticatedFetch, loadRemoteDraft } = await getDraftApi();
      const remoteDraft = await loadRemoteDraft().catch(() => null);
      const fallbackDraft = loadDashboardDraft();
      const nextDraft =
        remoteDraft ??
        (fallbackDraft?.email.trim().toLowerCase() === userEmail.trim().toLowerCase()
          ? fallbackDraft
          : null);

      if (nextDraft) {
        saveDashboardDraft(nextDraft);
      }

      setDraft(nextDraft);

      const recordsResponse = await authenticatedFetch("/api/care-records", {
        method: "GET"
      });
      const recordsData = (await recordsResponse.json()) as {
        items?: CareRecordItem[];
        error?: string;
      };

      if (!recordsResponse.ok) {
        throw new Error(recordsData.error ?? "Unable to load Care Records.");
      }

      setCareRecords(recordsData.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load your workspace.");
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    async function initialize() {
      try {
        const [{ getCurrentAuthUser }, supabase] = await Promise.all([
          getDraftApi(),
          getSupabaseClient()
        ]);

        const user = await getCurrentAuthUser();
        if (!active) {
          return;
        }

        if (user?.email) {
          await loadDashboardData(user.email);
        }

        const {
          data: { subscription }
        } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!active) {
            return;
          }

          if (session?.user?.email) {
            await loadDashboardData(session.user.email);
          } else if (event === "SIGNED_OUT") {
            clearDashboardDraft();
            setAuthenticated(false);
            setLoadingData(false);
            setDraft(null);
            setCareRecords([]);
            setPassword("");
            setConfirmPassword("");
          }
        });

        unsubscribe = () => subscription.unsubscribe();
      } finally {
        if (active) {
          setAuthReady(true);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  async function handleAuthSubmit() {
    if (!email.trim()) {
      setError("Email is required.");
      setNotice("");
      return;
    }

    if (!password.trim()) {
      setError("Password is required.");
      setNotice("");
      return;
    }

    if (authMode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      setNotice("");
      return;
    }

    setAuthLoading(true);
    setError("");
    setNotice("");

    try {
      const supabase = await getSupabaseClient();

      if (authMode === "signup") {
        const signUpResponse = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password })
        });
        const signUpData = (await signUpResponse.json()) as { error?: string };
        if (!signUpResponse.ok) {
          throw new Error(signUpData.error ?? "Unable to create the account.");
        }
      }

      let { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError && isEmailNotConfirmedError(signInError)) {
        const confirmResponse = await fetch("/api/auth/confirm-existing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password })
        });

        if (!confirmResponse.ok) {
          const confirmData = (await confirmResponse.json()) as { error?: string };
          throw new Error(confirmData.error ?? "Unable to sign in.");
        }

        ({ error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        }));
      }

      if (signInError) {
        throw signInError;
      }

      setPassword("");
      setConfirmPassword("");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Unable to sign in.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      setNotice("");
      return;
    }

    setAuthLoading(true);
    setError("");
    setNotice("");

    try {
      const supabase = await getSupabaseClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: new URL("/update-password", window.location.origin).toString()
      });

      if (resetError) {
        throw resetError;
      }

      setNotice("Password reset email sent.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to send reset email.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    clearDashboardDraft();
    setError("");
    setNotice("");
    const supabase = await getSupabaseClient();
    await supabase.auth.signOut();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <section className="w-full rounded-[28px] border border-border bg-white/95 p-6 shadow-card sm:p-8">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-accent">
            {APP_NAME}
          </p>
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">Caregiver Handoff</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Capture what only you know, and organize the records someone else would need.
          </p>
        </div>

        {error ? (
          <div className="mt-6">
            <StatusBanner tone="error">{error}</StatusBanner>
          </div>
        ) : null}
        {!error && notice ? (
          <div className="mt-6">
            <StatusBanner tone="success">{notice}</StatusBanner>
          </div>
        ) : null}

        {!authenticated ? (
          <section className="mt-8 space-y-5 rounded-3xl border border-border bg-canvas px-5 py-5">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1">
              <button
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  authMode === "signin" ? "bg-accent text-white" : "text-slate-600"
                }`}
                type="button"
                onClick={() => setAuthMode("signin")}
              >
                Sign in
              </button>
              <button
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  authMode === "signup" ? "bg-accent text-white" : "text-slate-600"
                }`}
                type="button"
                onClick={() => setAuthMode("signup")}
              >
                Create account
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 sm:col-span-2">
                <span className="text-sm font-medium text-slate-700">Email address</span>
                <input
                  autoComplete="email"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError("");
                    setNotice("");
                  }}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">Password</span>
                <input
                  autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                    setNotice("");
                  }}
                />
              </label>
              {authMode === "signup" ? (
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-700">Confirm password</span>
                  <input
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      setError("");
                      setNotice("");
                    }}
                  />
                </label>
              ) : null}
            </div>

            {authMode === "signin" ? (
              <button
                className="text-sm font-medium text-accent transition hover:text-teal-700"
                disabled={authLoading || !authReady}
                type="button"
                onClick={() => void handleForgotPassword()}
              >
                Forgot password?
              </button>
            ) : null}

            <button
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={authLoading || !authReady}
              type="button"
              onClick={() => void handleAuthSubmit()}
            >
              {authLoading
                ? authMode === "signin"
                  ? "Signing in..."
                  : "Creating account..."
                : authMode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </section>
        ) : (
          <div className="mt-8 space-y-6">
            <div className="flex flex-col gap-3 rounded-3xl border border-border bg-canvas px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Signed in as {email}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Choose the workspace you want to continue.
                </p>
              </div>
              <button
                className="rounded-2xl border border-border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                type="button"
                onClick={() => void handleSignOut()}
              >
                Sign out
              </button>
            </div>

            <div className={`grid gap-4 md:grid-cols-2 ${loadingData ? "opacity-60" : ""}`}>
              <Link
                className="block rounded-3xl border border-border bg-white px-5 py-5 shadow-card transition hover:-translate-y-0.5 hover:border-accent"
                href={knowPath}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-xl font-semibold text-ink">Know My Loved One</h2>
                    <span className="rounded-full bg-accentSoft px-3 py-1 text-xs font-semibold text-accent">
                      {knowStatus}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">
                    Capture routines, communication, preferences, triggers, strengths, and care
                    insights.
                  </p>
                  <span className="inline-flex text-sm font-semibold text-accent">
                    Open workflow
                  </span>
                </div>
              </Link>

              <Link
                className="block rounded-3xl border border-border bg-white px-5 py-5 shadow-card transition hover:-translate-y-0.5 hover:border-accent"
                href="/care-records"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-xl font-semibold text-ink">Care Records</h2>
                    <span className="rounded-full bg-accentSoft px-3 py-1 text-xs font-semibold text-accent">
                      {careRecordsStatus}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">
                    Type or upload records and let AI organize details into reviewed categories.
                  </p>
                  <span className="inline-flex text-sm font-semibold text-accent">
                    Open workspace
                  </span>
                </div>
              </Link>
            </div>

            <Link
              className="block rounded-3xl border border-accent bg-accent px-5 py-4 text-center text-sm font-semibold text-white transition hover:bg-teal-700"
              href="/handoff"
            >
              View Complete Handoff
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

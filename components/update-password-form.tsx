"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { getResetPasswordCopy } from "@/lib/localization";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { UiLanguage } from "@/lib/types";

function normalizeLanguage(value: string | null): UiLanguage {
  if (value === "spanish" || value === "mandarin" || value === "english") {
    return value;
  }

  return "english";
}

export function UpdatePasswordForm() {
  const router = useRouter();
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [checkingLink, setCheckingLink] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const copy = useMemo(() => getResetPasswordCopy(uiLanguage), [uiLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setUiLanguage(normalizeLanguage(params.get("lang")));
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    async function initialize() {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      setRecoveryReady(Boolean(session));
      setCheckingLink(false);
    }

    void initialize();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" || session) {
        setRecoveryReady(true);
        setCheckingLink(false);
        setError("");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit() {
    if (!password.trim()) {
      setError(copy.passwordRequired);
      setSuccess("");
      return;
    }

    if (!confirmPassword.trim()) {
      setError(copy.confirmPasswordRequired);
      setSuccess("");
      return;
    }

    if (password !== confirmPassword) {
      setError(copy.passwordMismatch);
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) {
        throw updateError;
      }

      setSuccess(copy.successMessage);
      window.setTimeout(() => {
        router.replace("/");
      }, 1200);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : copy.updateFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title={copy.title} subtitle={copy.subtitle}>
      <div className="space-y-4">
        {checkingLink ? <StatusBanner tone="info">{copy.checkingLink}</StatusBanner> : null}
        {!checkingLink && !recoveryReady ? (
          <>
            <StatusBanner tone="error">{copy.invalidLinkMessage}</StatusBanner>
            <button
              className="w-full rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-canvas"
              type="button"
              onClick={() => router.replace("/")}
            >
              {copy.backToSignIn}
            </button>
          </>
        ) : null}
        {!checkingLink && recoveryReady ? (
          <>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">{copy.passwordLabel}</span>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                type="password"
                value={password}
                onChange={(event) => {
                  setError("");
                  setSuccess("");
                  setPassword(event.target.value);
                }}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">{copy.confirmPasswordLabel}</span>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setError("");
                  setSuccess("");
                  setConfirmPassword(event.target.value);
                }}
              />
            </label>

            {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
            {!error && success ? <StatusBanner tone="success">{success}</StatusBanner> : null}

            <button
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              type="button"
              onClick={handleSubmit}
            >
              {saving ? copy.savingButton : copy.saveButton}
            </button>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

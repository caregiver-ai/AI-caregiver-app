"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { APP_NAME } from "@/lib/constants";
import { getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { UI_LANGUAGE_OPTIONS, getWelcomeCopy } from "@/lib/localization";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { clearDraft, loadDraft, saveDraft } from "@/lib/storage";
import { SessionDraft, SessionIntakeDetails, UiLanguage } from "@/lib/types";

type AuthMode = "signin" | "signup";
type ValidationField =
  | "caregiverFirstName"
  | "caregiverLastName"
  | "caregiver55OrOlder"
  | "careRecipientFirstName"
  | "careRecipientLastName"
  | "careRecipientDateOfBirth"
  | "consent";

const EMPTY_INTAKE_DETAILS: SessionIntakeDetails = {
  caregiverFirstName: "",
  caregiverLastName: "",
  caregiver55OrOlder: "",
  caregiverPhone: "",
  careRecipientFirstName: "",
  careRecipientLastName: "",
  careRecipientPreferredName: "",
  careRecipientDateOfBirth: "",
  preferredLanguage: "english"
};

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

function hasDraftContent(intakeDetails: SessionIntakeDetails, consented: boolean) {
  return (
    consented ||
    Object.entries(intakeDetails).some(([field, value]) => {
      if (field === "preferredLanguage") {
        return value !== "english";
      }

      return typeof value === "string" && value.trim().length > 0;
    })
  );
}

function isEmailNotConfirmedError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("email not confirmed");
}

export function WelcomeForm() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationField, setValidationField] = useState<ValidationField | "">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [consented, setConsented] = useState(false);
  const [intakeDetails, setIntakeDetails] = useState<SessionIntakeDetails>(EMPTY_INTAKE_DETAILS);
  const fieldRefs = useRef<Partial<Record<ValidationField, HTMLElement | null>>>({});
  const uiLanguage = intakeDetails.preferredLanguage;
  const copy = useMemo(() => getWelcomeCopy(uiLanguage), [uiLanguage]);

  function registerFieldRef(field: ValidationField) {
    return (element: HTMLElement | null) => {
      fieldRefs.current[field] = element;
    };
  }

  function showValidationError(field: ValidationField, message: string) {
    setValidationField(field);
    setError(message);

    window.requestAnimationFrame(() => {
      const element = fieldRefs.current[field];
      if (!element) {
        return;
      }

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus();
    });
  }

  function updateField<Field extends keyof SessionIntakeDetails>(
    field: Field,
    value: SessionIntakeDetails[Field]
  ) {
    setError("");
    if (field === validationField) {
      setValidationField("");
    }

    setIntakeDetails((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function hydrateSignedInState(userEmail: string) {
    setDraftLoading(true);
    setAuthenticated(true);
    setEmail(userEmail);
    setSessionId("");
    setConsented(false);
    setValidationField("");
    setError("");

    const localDraft = loadDraft();
    if (localDraft?.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
      clearDraft();
    }

    try {
      const remoteDraft = await loadRemoteDraft();
      const latestLocalDraft = loadDraft();
      const draft =
        remoteDraft ??
        (latestLocalDraft?.email.trim().toLowerCase() === userEmail.trim().toLowerCase()
          ? latestLocalDraft
          : null);

      if (!draft) {
        setSessionId("");
        setConsented(false);
        setIntakeDetails((current) => ({
          ...EMPTY_INTAKE_DETAILS,
          preferredLanguage: current.preferredLanguage
        }));
        clearDraft();
        return;
      }

      setSessionId(draft.sessionId);
      setConsented(draft.consented);
      setIntakeDetails({
        ...EMPTY_INTAKE_DETAILS,
        ...draft.intakeDetails
      });
      saveDraft(draft);
    } catch (loadError) {
      const localDraft = loadDraft();
      if (localDraft?.email === userEmail) {
        setSessionId(localDraft.sessionId);
        setConsented(localDraft.consented);
        setIntakeDetails({
          ...EMPTY_INTAKE_DETAILS,
          ...localDraft.intakeDetails
        });
      } else {
        setError(loadError instanceof Error ? loadError.message : copy.errors.authFailed);
      }
    } finally {
      setDraftLoading(false);
    }
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    async function initialize() {
      try {
        const user = await getCurrentAuthUser();
        if (!active) {
          return;
        }

        if (user?.email) {
          await hydrateSignedInState(user.email);
        }
      } finally {
        if (active) {
          setAuthReady(true);
        }
      }
    }

    void initialize();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) {
        return;
      }

      if (session?.user?.email) {
        await hydrateSignedInState(session.user.email);
      } else if (event === "SIGNED_OUT") {
        clearDraft();
        setAuthenticated(false);
        setDraftLoading(false);
        setSessionId("");
        setConsented(false);
        setPassword("");
        setConfirmPassword("");
        setIntakeDetails((current) => ({
          ...EMPTY_INTAKE_DETAILS,
          preferredLanguage: current.preferredLanguage
        }));
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function persistDraft(status: string) {
    const existingDraft = loadDraft();
    const normalizedEmail = email.trim().toLowerCase();
    const matchingExistingDraft =
      existingDraft?.email.trim().toLowerCase() === normalizedEmail ? existingDraft : null;
    const nextDraft: SessionDraft = {
      sessionId: matchingExistingDraft?.sessionId || sessionId || crypto.randomUUID(),
      email: normalizedEmail,
      consented,
      intakeDetails,
      turns: matchingExistingDraft?.turns ?? [],
      structuredSummary: matchingExistingDraft?.structuredSummary,
      editedSummary: matchingExistingDraft?.editedSummary,
      feedback: matchingExistingDraft?.feedback
    };

    saveDraft(nextDraft);
    const savedDraft = await saveRemoteDraft(nextDraft, status);
    saveDraft(savedDraft);
    setSessionId(savedDraft.sessionId);

    return savedDraft;
  }

  useEffect(() => {
    if (!authReady || !authenticated || draftLoading) {
      return;
    }

    if (!hasDraftContent(intakeDetails, consented) && !sessionId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistDraft("draft").catch(() => {
        // Autosave should not interrupt data entry.
      });
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authReady, authenticated, draftLoading, sessionId, consented, intakeDetails, email]);

  async function handleAuthSubmit() {
    if (!email.trim()) {
      setError(copy.errors.email);
      return;
    }

    if (!password.trim()) {
      setError(copy.errors.password);
      return;
    }

    if (authMode === "signup" && !confirmPassword.trim()) {
      setError(copy.errors.confirmPassword);
      return;
    }

    if (authMode === "signup" && password !== confirmPassword) {
      setError(copy.errors.passwordMismatch);
      return;
    }

    setAuthLoading(true);
    setError("");

    try {
      const supabase = getSupabaseBrowserClient();

      if (authMode === "signup") {
        const signUpResponse = await fetch("/api/auth/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: email.trim(),
            password
          })
        });

        const signUpData = (await signUpResponse.json()) as { error?: string };
        if (!signUpResponse.ok) {
          throw new Error(signUpData.error ?? copy.errors.authFailed);
        }

        const { error: signInAfterCreateError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (signInAfterCreateError) {
          throw new Error(copy.errors.confirmationRequired);
        }
      } else {
        let { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (signInError) {
          if (isEmailNotConfirmedError(signInError)) {
            const confirmResponse = await fetch("/api/auth/confirm-existing", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                email: email.trim(),
                password
              })
            });

            if (!confirmResponse.ok) {
              const confirmData = (await confirmResponse.json()) as { error?: string };
              throw new Error(confirmData.error ?? copy.errors.authFailed);
            }

            ({ error: signInError } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password
            }));
          }
        }

        if (signInError) {
          throw signInError;
        }
      }

      setPassword("");
      setConfirmPassword("");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : copy.errors.authFailed);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    setError("");
    setValidationField("");
    clearDraft();
    setSessionId("");
    setConsented(false);
    setPassword("");
    setConfirmPassword("");

    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
  }

  async function handleStart() {
    if (!authenticated) {
      setError(copy.errors.authFailed);
      return;
    }

    if (!intakeDetails.caregiverFirstName.trim()) {
      showValidationError("caregiverFirstName", copy.errors.caregiverFirstName);
      return;
    }

    if (!intakeDetails.caregiverLastName.trim()) {
      showValidationError("caregiverLastName", copy.errors.caregiverLastName);
      return;
    }

    if (!intakeDetails.caregiver55OrOlder) {
      showValidationError("caregiver55OrOlder", copy.errors.caregiver55OrOlder);
      return;
    }

    if (!intakeDetails.careRecipientFirstName.trim()) {
      showValidationError("careRecipientFirstName", copy.errors.careRecipientFirstName);
      return;
    }

    if (!intakeDetails.careRecipientLastName.trim()) {
      showValidationError("careRecipientLastName", copy.errors.careRecipientLastName);
      return;
    }

    if (!hasValidOptionalDate(intakeDetails.careRecipientDateOfBirth)) {
      showValidationError("careRecipientDateOfBirth", copy.errors.careRecipientDateOfBirth);
      return;
    }

    if (!consented) {
      showValidationError("consent", copy.errors.consent);
      return;
    }

    setLoading(true);
    setError("");
    setValidationField("");

    try {
      await persistDraft("in_progress");
      router.push("/reflection");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.errors.startFailed);
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
              <h1 className="text-3xl font-semibold text-ink sm:whitespace-nowrap sm:text-4xl">
                {copy.title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                {copy.subtitle}
              </p>
              <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                {copy.subtitleSecondary}
              </p>
            </div>
            <label className="block sm:w-56">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:whitespace-nowrap">
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
          <section className="space-y-4 rounded-3xl border border-border bg-canvas px-5 py-5">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                {copy.authTitle}
              </h2>
              <p className="text-sm leading-6 text-slate-600">{copy.authSubtitle}</p>
            </div>

            {!authenticated ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1">
                  <button
                    className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                      authMode === "signin" ? "bg-accent text-white" : "text-slate-600"
                    }`}
                    type="button"
                    onClick={() => setAuthMode("signin")}
                  >
                    {copy.signInTab}
                  </button>
                  <button
                    className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                      authMode === "signup" ? "bg-accent text-white" : "text-slate-600"
                    }`}
                    type="button"
                    onClick={() => setAuthMode("signup")}
                  >
                    {copy.createAccountTab}
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2 sm:col-span-2">
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
                    <FieldLabel optionalLabel={copy.optional}>{copy.passwordLabel}</FieldLabel>
                    <input
                      autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                      className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  {authMode === "signup" ? (
                    <label className="block space-y-2">
                      <FieldLabel optionalLabel={copy.optional}>
                        {copy.confirmPasswordLabel}
                      </FieldLabel>
                      <input
                        autoComplete="new-password"
                        className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </label>
                  ) : null}
                </div>

                <button
                  className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={authLoading || !authReady}
                  type="button"
                  onClick={handleAuthSubmit}
                >
                  {authLoading
                    ? authMode === "signin"
                      ? copy.signingInLabel
                      : copy.creatingAccountLabel
                    : authMode === "signin"
                      ? copy.signInButton
                      : copy.createAccountButton}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-700">{copy.signedInAs(email)}</p>
                <button
                  className="rounded-2xl border border-border px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  type="button"
                  onClick={() => void handleSignOut()}
                >
                  {copy.signOutButton}
                </button>
              </div>
            )}
          </section>

          <section className={`space-y-8 ${!authenticated || draftLoading ? "opacity-60" : ""}`}>
            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                {copy.aboutYou}
              </h2>
              <p className="text-sm italic leading-6 text-slate-600">{copy.aboutYouSubtitle}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <FieldLabel optionalLabel={copy.optional}>{copy.yourFirstName}</FieldLabel>
                  <input
                    autoComplete="given-name"
                    aria-invalid={validationField === "caregiverFirstName"}
                    className={`w-full rounded-2xl border px-4 py-3 outline-none transition disabled:bg-slate-50 ${
                      validationField === "caregiverFirstName"
                        ? "border-red-400 focus:border-red-500"
                        : "border-border focus:border-accent"
                    }`}
                    disabled={!authenticated || draftLoading}
                    placeholder={copy.placeholders.caregiverFirstName}
                    ref={registerFieldRef("caregiverFirstName")}
                    type="text"
                    value={intakeDetails.caregiverFirstName}
                    onChange={(event) => updateField("caregiverFirstName", event.target.value)}
                  />
                  {validationField === "caregiverFirstName" ? (
                    <p className="text-sm text-red-600">{copy.errors.caregiverFirstName}</p>
                  ) : null}
                </label>
                <label className="block space-y-2">
                  <FieldLabel optionalLabel={copy.optional}>{copy.yourLastName}</FieldLabel>
                  <input
                    autoComplete="family-name"
                    aria-invalid={validationField === "caregiverLastName"}
                    className={`w-full rounded-2xl border px-4 py-3 outline-none transition disabled:bg-slate-50 ${
                      validationField === "caregiverLastName"
                        ? "border-red-400 focus:border-red-500"
                        : "border-border focus:border-accent"
                    }`}
                    disabled={!authenticated || draftLoading}
                    placeholder={copy.placeholders.caregiverLastName}
                    ref={registerFieldRef("caregiverLastName")}
                    type="text"
                    value={intakeDetails.caregiverLastName}
                    onChange={(event) => updateField("caregiverLastName", event.target.value)}
                  />
                  {validationField === "caregiverLastName" ? (
                    <p className="text-sm text-red-600">{copy.errors.caregiverLastName}</p>
                  ) : null}
                </label>
              </div>
              <label className="block space-y-2">
                <FieldLabel optionalLabel={copy.optional}>{copy.caregiver55OrOlder}</FieldLabel>
                <select
                  aria-invalid={validationField === "caregiver55OrOlder"}
                  className={`w-full rounded-2xl border bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition disabled:bg-slate-50 ${
                    validationField === "caregiver55OrOlder"
                      ? "border-red-400 focus:border-red-500"
                      : "border-border focus:border-accent"
                  }`}
                  disabled={!authenticated || draftLoading}
                  ref={registerFieldRef("caregiver55OrOlder")}
                  value={intakeDetails.caregiver55OrOlder}
                  onChange={(event) =>
                    updateField(
                      "caregiver55OrOlder",
                      event.target.value as SessionIntakeDetails["caregiver55OrOlder"]
                    )
                  }
                >
                  <option value="">{copy.selectPrompt}</option>
                  <option value="yes">{copy.yesOption}</option>
                  <option value="no">{copy.noOption}</option>
                </select>
                {validationField === "caregiver55OrOlder" ? (
                  <p className="text-sm text-red-600">{copy.errors.caregiver55OrOlder}</p>
                ) : null}
              </label>
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                {copy.aboutSupportedPerson}
              </h2>
              <p className="text-sm italic leading-6 text-slate-600">
                {copy.aboutSupportedPersonSubtitle}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <FieldLabel optionalLabel={copy.optional}>{copy.theirFirstName}</FieldLabel>
                  <input
                    aria-invalid={validationField === "careRecipientFirstName"}
                    className={`w-full rounded-2xl border px-4 py-3 outline-none transition disabled:bg-slate-50 ${
                      validationField === "careRecipientFirstName"
                        ? "border-red-400 focus:border-red-500"
                        : "border-border focus:border-accent"
                    }`}
                    disabled={!authenticated || draftLoading}
                    placeholder={copy.placeholders.careRecipientFirstName}
                    ref={registerFieldRef("careRecipientFirstName")}
                    type="text"
                    value={intakeDetails.careRecipientFirstName}
                    onChange={(event) => updateField("careRecipientFirstName", event.target.value)}
                  />
                  {validationField === "careRecipientFirstName" ? (
                    <p className="text-sm text-red-600">{copy.errors.careRecipientFirstName}</p>
                  ) : null}
                </label>
                <label className="block space-y-2">
                  <FieldLabel optionalLabel={copy.optional}>{copy.theirLastName}</FieldLabel>
                  <input
                    aria-invalid={validationField === "careRecipientLastName"}
                    className={`w-full rounded-2xl border px-4 py-3 outline-none transition disabled:bg-slate-50 ${
                      validationField === "careRecipientLastName"
                        ? "border-red-400 focus:border-red-500"
                        : "border-border focus:border-accent"
                    }`}
                    disabled={!authenticated || draftLoading}
                    placeholder={copy.placeholders.careRecipientLastName}
                    ref={registerFieldRef("careRecipientLastName")}
                    type="text"
                    value={intakeDetails.careRecipientLastName}
                    onChange={(event) => updateField("careRecipientLastName", event.target.value)}
                  />
                  {validationField === "careRecipientLastName" ? (
                    <p className="text-sm text-red-600">{copy.errors.careRecipientLastName}</p>
                  ) : null}
                </label>
              </div>
              <label className="block space-y-2">
                <FieldLabel optional optionalLabel={copy.optional}>
                  {copy.theirPreferredName}
                </FieldLabel>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent disabled:bg-slate-50"
                  disabled={!authenticated || draftLoading}
                  placeholder={copy.placeholders.careRecipientPreferredName}
                  type="text"
                  value={intakeDetails.careRecipientPreferredName}
                  onChange={(event) => updateField("careRecipientPreferredName", event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel optional optionalLabel={copy.optional}>
                  {copy.theirDateOfBirth}
                </FieldLabel>
                <input
                  aria-invalid={validationField === "careRecipientDateOfBirth"}
                  className={`block w-full max-w-full min-w-0 appearance-none rounded-2xl border px-4 py-3 outline-none transition disabled:bg-slate-50 ${
                    validationField === "careRecipientDateOfBirth"
                      ? "border-red-400 focus:border-red-500"
                      : "border-border focus:border-accent"
                  }`}
                  disabled={!authenticated || draftLoading}
                  ref={registerFieldRef("careRecipientDateOfBirth")}
                  type="date"
                  value={intakeDetails.careRecipientDateOfBirth}
                  onChange={(event) => updateField("careRecipientDateOfBirth", event.target.value)}
                />
                {validationField === "careRecipientDateOfBirth" ? (
                  <p className="text-sm text-red-600">{copy.errors.careRecipientDateOfBirth}</p>
                ) : null}
              </label>
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
                    className="w-full rounded-2xl border border-border bg-slate-50 px-4 py-3 text-slate-500 outline-none"
                    readOnly
                    type="email"
                    value={email}
                  />
                </label>
                <label className="block space-y-2">
                  <FieldLabel optional optionalLabel={copy.optional}>
                    {copy.phoneNumber}
                  </FieldLabel>
                  <input
                    autoComplete="tel"
                    className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent disabled:bg-slate-50"
                    disabled={!authenticated || draftLoading}
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
                aria-invalid={validationField === "consent"}
                className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                disabled={!authenticated || draftLoading}
                ref={registerFieldRef("consent")}
                type="checkbox"
                onChange={(event) => {
                  setError("");
                  if (validationField === "consent") {
                    setValidationField("");
                  }
                  setConsented(event.target.checked);
                }}
              />
              <span className="text-sm leading-6 text-slate-700">{copy.consent}</span>
            </label>
            <p className="text-sm leading-6 text-slate-600">{copy.privacyNote}</p>
            {validationField === "consent" ? (
              <p className="text-sm text-red-600">{copy.errors.consent}</p>
            ) : null}
          </section>

          {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading || !authenticated || draftLoading || !authReady}
            type="button"
            onClick={handleStart}
          >
            {loading ? copy.startingLabel : copy.continueLabel}
          </button>
          <p className="text-sm leading-6 text-slate-700">{copy.continueHint}</p>
        </div>
      </section>
    </main>
  );
}

"use client";

import { getStoredSupabaseSession, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { SessionDraft } from "@/lib/types";

type DraftResponse = {
  draft: SessionDraft | null;
};

function isMissingOwnedDraftError(status: number, error?: string) {
  return status === 404 && error === "Unable to find that saved draft for this account.";
}

async function waitForAuthSession() {
  const supabase = getSupabaseBrowserClient();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 400))
    ]);

    if (session) {
      return session;
    }

    const storedSession = getStoredSupabaseSession();
    if (storedSession?.access_token) {
      return storedSession;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }

  return getStoredSupabaseSession();
}

async function getAccessToken() {
  const session = await waitForAuthSession();
  return session?.access_token ?? null;
}

async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("You need to sign in to continue.");
  }

  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`
    }
  });
}

export async function loadRemoteDraft() {
  const response = await authenticatedFetch("/api/draft", {
    method: "GET"
  });

  const data = (await response.json()) as DraftResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Unable to load your saved progress.");
  }

  return data.draft;
}

export async function saveRemoteDraft(draft: SessionDraft, status: string) {
  const response = await authenticatedFetch("/api/draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      draft,
      status
    })
  });

  const data = (await response.json()) as DraftResponse & { error?: string };
  if (isMissingOwnedDraftError(response.status, data.error)) {
    const resetDraft = {
      ...draft,
      sessionId: crypto.randomUUID()
    };

    const retryResponse = await authenticatedFetch("/api/draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft: resetDraft,
        status
      })
    });

    const retryData = (await retryResponse.json()) as DraftResponse & { error?: string };
    if (!retryResponse.ok) {
      throw new Error(retryData.error ?? "Unable to save your progress.");
    }

    if (!retryData.draft) {
      throw new Error("The server did not return a saved draft.");
    }

    return retryData.draft;
  }

  if (!response.ok) {
    throw new Error(data.error ?? "Unable to save your progress.");
  }

  if (!data.draft) {
    throw new Error("The server did not return a saved draft.");
  }

  return data.draft;
}

export async function getCurrentAuthUser() {
  const supabase = getSupabaseBrowserClient();
  const session = await waitForAuthSession();
  if (session?.user) {
    return session.user;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user;
}

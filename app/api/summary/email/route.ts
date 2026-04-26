import { NextResponse } from "next/server";
import { createSummaryPdf, buildSummaryEmailHtml, sanitizePdfFilename } from "@/lib/summary-pdf";
import { summaryHasContent } from "@/lib/summary-display";
import { getSummaryFreshness } from "@/lib/summary-structured";
import { normalizeEditableStructuredSummary, summaryToPlainText } from "@/lib/summary";
import { finalizeSummaryWithQa } from "@/lib/summary-audit";
import { createSupabaseServerClient, getSupabaseAuthUserFromRequest } from "@/lib/supabase";
import { SessionDraft, StructuredSummary } from "@/lib/types";

type SessionRow = {
  id: string;
  user_id: string | null;
  draft_json?: SessionDraft | null;
};

type SummaryRow = {
  summary_json?: unknown;
  edited_json?: unknown;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function resolvePublicUser(authUser: { id: string; email?: string | null }) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server client is not configured.");
  }

  const email = authUser.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Authenticated user is missing an email address.");
  }

  let { data: userRecord, error: userLookupError } = await supabase
    .from("users")
    .select("id, email, auth_user_id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (userLookupError) {
    throw new Error(userLookupError.message);
  }

  if (!userRecord) {
    const { data: emailMatchedUser, error: emailLookupError } = await supabase
      .from("users")
      .select("id, email, auth_user_id")
      .eq("email", email)
      .maybeSingle();

    if (emailLookupError) {
      throw new Error(emailLookupError.message);
    }

    if (emailMatchedUser) {
      const { error: updateError } = await supabase
        .from("users")
        .update({ auth_user_id: authUser.id })
        .eq("id", emailMatchedUser.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      userRecord = {
        ...emailMatchedUser,
        auth_user_id: authUser.id
      };
    }
  }

  if (!userRecord) {
    throw new Error("Unable to resolve this account.");
  }

  return {
    supabase,
    publicUserId: userRecord.id
  };
}

function buildEditUrl(request: Request) {
  return new URL("/review", request.url).toString();
}

function buildSummaryEmailText(summary: StructuredSummary, editUrl: string) {
  const baseText = summaryToPlainText(summary);

  return `${baseText}\n\nReview or edit this summary in the app: ${editUrl}`;
}

export async function POST(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    recipientEmail?: string;
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const recipientEmail = normalizeEmail(body.recipientEmail ?? "");
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !resendFromEmail) {
    return NextResponse.json(
      {
        error: "Email sending is not configured yet. Add RESEND_API_KEY and RESEND_FROM_EMAIL."
      },
      { status: 500 }
    );
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const { data: sessionRow, error: sessionLookupError } = await supabase
      .from("sessions")
      .select("id, user_id, draft_json")
      .eq("id", body.sessionId)
      .eq("user_id", publicUserId)
      .maybeSingle();

    if (sessionLookupError) {
      return NextResponse.json({ error: sessionLookupError.message }, { status: 500 });
    }

    if (!sessionRow) {
      return NextResponse.json({ error: "Unable to find that saved summary." }, { status: 404 });
    }

    const { data: summaryRow, error: summaryLookupError } = await supabase
      .from("summaries")
      .select("summary_json, edited_json")
      .eq("session_id", body.sessionId)
      .maybeSingle();

    if (summaryLookupError) {
      return NextResponse.json({ error: summaryLookupError.message }, { status: 500 });
    }

    const generatedSummary = normalizeEditableStructuredSummary(
      (summaryRow as SummaryRow | null)?.summary_json ?? (sessionRow as SessionRow).draft_json?.structuredSummary
    );
    const editedSummary = normalizeEditableStructuredSummary(
      (summaryRow as SummaryRow | null)?.edited_json ??
        (sessionRow as SessionRow).draft_json?.editedSummary ??
        generatedSummary
    );
    const freshness = getSummaryFreshness(
      (sessionRow as SessionRow).draft_json?.turns ?? [],
      generatedSummary,
      editedSummary
    );

    if (freshness.requiresRegeneration) {
      return NextResponse.json(
        {
          error: "This saved summary is out of date. Regenerate it from the saved answers before emailing it."
        },
        { status: 409 }
      );
    }

    if (!summaryHasContent(editedSummary)) {
      return NextResponse.json({ error: "No saved summary is available to send." }, { status: 404 });
    }

    const { summary: qaSummary } = finalizeSummaryWithQa(editedSummary, {
      source: "saved"
    });
    const pdfBytes = await createSummaryPdf(qaSummary);
    const filename = `${sanitizePdfFilename(qaSummary.title)}.pdf`;
    const editUrl = buildEditUrl(request);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: [recipientEmail],
        subject: qaSummary.title || "Caregiver Handoff Summary",
        html: buildSummaryEmailHtml(qaSummary, editUrl),
        text: buildSummaryEmailText(qaSummary, editUrl),
        attachments: [
          {
            filename,
            content: Buffer.from(pdfBytes).toString("base64")
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: `Email send failed: ${errorText}`
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to send the summary email."
      },
      { status: 500 }
    );
  }
}

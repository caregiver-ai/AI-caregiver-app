# Caregiver AI

Preserve what only you know, so it's available whenever it's needed.

Caregiver AI is a Next.js prototype for family caregivers. After sign-in, caregivers choose between two separate workspaces:

- **Caregiver Handoff**: for everyday caregiving. A practical guide for providing consistent, person-centered support.
- **Life Records**: for long-term caregiving. A comprehensive reference for transitions, future planning, and important records.

The two workflows intentionally stay separate because they serve different audiences. Caregiver Handoff can be shared broadly with people providing day-to-day support. Life Records may contain legal, medical, financial, benefits, and administrative information, so it has its own data model and output.

Production: [https://ai-caregiver-app.vercel.app](https://ai-caregiver-app.vercel.app)

## Tech Stack

- Next.js 14 App Router
- React 18 + TypeScript
- Tailwind CSS
- Supabase Auth + Postgres
- OpenAI API for transcription, translation, summary generation, and Life Records extraction
- `pdf-lib` for browser-generated PDF downloads
- `heic-convert` for HEIC/HEIF image conversion before extraction
- Resend for Caregiver Handoff email delivery
- Vercel hosting

## Product Workflows

### Caregiver Handoff

Caregiver Handoff is the existing guided intake flow. It captures the practical knowledge only a caregiver may know and turns it into a caregiver-ready guide.

1. The caregiver signs in with email and password.
2. The intake screen collects caregiver details, care recipient details, consent, and preferred site language.
3. Draft state is saved locally and, when authenticated, synced to Supabase.
4. The reflection flow asks guided caregiver questions in English, Spanish, or Mandarin.
5. Responses can be typed or recorded with audio.
6. Audio is transcribed and, for Spanish or Mandarin, normalized into English before entering the summary pipeline.
7. The caregiver can revisit earlier prompts, edit responses, and continue an in-progress draft later.
8. The review step generates a structured Caregiver Handoff guide, runs QA cleanup, and allows inline editing plus regeneration from saved answers.
9. The completion step collects feedback and supports PDF download and email delivery of the finalized handoff.

The caregiver-facing guide uses these sections when supported by the captured facts:

- `Caring for [Name]`
- `About [Name]`
- `Communication`
- `Understanding and Learning`
- `Daily Routine`
- `Food and Meals`
- `Activities and Interests`
- `What Can Upset or Overwhelm [Name]`
- `Signs [Name] Needs Help`
- `What Helps When [Name] Is Having a Hard Time`
- `Health & Safety`
- `Quick Tips for New Caregivers`

### Life Records

Life Records is a separate workflow for records caregivers rely on during transitions and future planning.

1. The caregiver types or pastes information, or uploads one image/PDF file for extraction.
2. Supported uploads are PDF, PNG, JPG/JPEG, WebP, HEIC, and HEIF.
3. Uploaded files are used only during the extraction request. Original uploaded files are not stored.
4. AI extracts suggested structured items and places them into Life Records categories.
5. The caregiver reviews, edits, and approves each suggestion before it becomes part of the output.
6. `Save approved records for future editing` is checked by default.
7. If checked, approved records are saved to Supabase and reload with the workspace.
8. If unchecked, approved records are added only to the current printable document state and are not written to the server.
9. The page includes a clean Life Records output that can be printed, saved as PDF, or downloaded as a generated PDF.

Life Records categories:

- `Living Situation`
- `Important People`
- `Legal Decision Making`
- `Health Care`
- `Support Services`
- `Government Resources`
- `Financial Resources`
- `Professional Advisors`
- `Documents`

`Health Care` explicitly includes insurance. Legacy saved category IDs are normalized by migration and server code:

- `health_insurance` -> `health_care`
- `support_government` -> `support_services`
- `financial_advisors` -> `financial_resources`

Life Records v1 is English-only and is not a full document management system.

## Summary Pipeline

Caregiver Handoff uses a structured artifact pipeline with persistence and QA:

1. Source turns are read from `sessions.draft_json.turns`.
2. The model captures atomic facts from questionnaire input so details are not lost.
3. The app groups related facts into a caregiver-guide layout with section intros, labeled groups, and compact caregiver-ready guidance.
4. The app normalizes and audits the output for section placement, duplicate/noisy bullets, title quality, visible coverage, and missing critical details.
5. The server persists:
   - the rendered summary in `summaries`
   - atomic facts in `summary_facts`
   - section item groups in `summary_section_summaries`
6. Regeneration refreshes these artifacts against the current `source_turns_hash`.
7. The caregiver can edit the summary before final confirmation.

The output is a structured JSON summary with:

- `title`
- `overview`
- `sections`
- optional section `intro`
- grouped section `blocks`
- `generatedAt`
- `layoutVersion`
- `pipelineVersion`
- `sourceTurnsHash`

## Data Model

Supabase handles authentication and persistence. Browser code does not write directly to Supabase for protected app data; it calls server-side API routes that resolve the authenticated user.

Shared table:

- `users`

Caregiver Handoff tables:

- `sessions`
- `summaries`
- `feedback`
- `summary_facts`
- `summary_section_summaries`

Life Records tables:

- `care_record_workspaces`
- `care_record_items`

Life Records shares only `users` with the Caregiver Handoff workflow. It does not write to `sessions`, `summaries`, or the summary artifact tables.

Life Records persistence notes:

- V1 supports one active Life Records workspace per user.
- `care_record_workspaces.user_id` references `users.id`.
- `care_record_items.workspace_id` references `care_record_workspaces.id`.
- Approved saved items store structured fields, notes, source type, source label, and review timestamps.
- Original uploaded images and PDFs are not stored.
- Print-only approvals created while `Save approved records for future editing` is unchecked are local to the current browser session.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env template:

```bash
cp .env.example .env.local
```

3. Add your environment variables.

4. Start the app:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000).

## Required Environment Variables

```bash
OPENAI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SECRET_KEY=
```

Also supported:

```bash
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_MODEL=gpt-5.5
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

`SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are interchangeable in the current server code. Only one is required.

If `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are missing, the app still runs, but Caregiver Handoff email sending is disabled.

If `OPENAI_API_KEY` is missing, Caregiver Handoff summary generation falls back to a lightweight heuristic summary so the app can still run locally. Life Records extraction requires the OpenAI API for AI extraction.

## Supabase

For a new project:

1. Create a Supabase project.
2. Apply `supabase/schema.sql`, or run the migrations in `supabase/migrations/`.
3. Add the Supabase env vars to `.env.local`.

If Supabase is not configured, the app can still keep a local browser draft for Caregiver Handoff, but auth-backed resume behavior and shared persistence require Supabase.

GitHub Actions is used for Supabase migrations:

- `.github/workflows/supabase-migrations.yml`

Required GitHub repo secret for migrations:

- `SUPABASE_DB_URL`

Use the Supabase session-pooler Postgres connection string for `SUPABASE_DB_URL`.

For schema changes:

1. Add a new timestamped SQL file under `supabase/migrations/`.
2. Keep `supabase/schema.sql` aligned with the latest schema snapshot.
3. Push the migration through the normal Git flow.
4. GitHub Actions applies the new migration to Supabase.

Changing only `supabase/schema.sql` is not enough for production.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run care-records:test
npm run summary:test
npm run summary:benchmark
npm run summary:review-cases
```

`care-records:test` checks Life Records category validation, extraction normalization, fallback extraction, PDF generation, and grouping helpers.

`summary:test` exercises the questionnaire contract, legacy draft migration, summary routing, and freshness logic directly.

`summary:benchmark` runs the benchmark fixture set against the current server-side summary flow and reports checks for completeness, section placement, duplicate bullets, and transcription noise.

`summary:review-cases` runs the current multi-case review gate against Gavin, Tatiana, Jevon, Joe, Ashley, and the raw Joe Word document.

## Routes

Pages:

- `/`: auth-backed dashboard with the two workflow modules
- `/know-my-loved-one`: Caregiver Handoff intake, auth fallback, and resume entry
- `/reflection`: guided reflection flow
- `/review`: Caregiver Handoff summary review and editing
- `/complete`: Caregiver Handoff completion, feedback, PDF download, and email send
- `/care-records`: Life Records extraction, review, saved records, and printable/PDF output
- `/update-password`: password reset completion

There is intentionally no combined `/handoff` page in v1. The two outputs remain separate.

API routes:

- `/api/session`: initial session creation
- `/api/draft`: auth-backed draft load/save
- `/api/transcribe`: transcription and English normalization
- `/api/summary`: initial Caregiver Handoff summary generation and persistence
- `/api/summary/regenerate`: regenerate from saved turns and persisted facts
- `/api/summary/save`: confirm edited summary and mark the session completed
- `/api/summary/email`: email the finalized Caregiver Handoff summary
- `/api/care-records`: load/create the Life Records workspace and save reviewed items
- `/api/care-records/extract`: extract unsaved Life Records suggestions from text, image, HEIC/HEIF, or PDF input
- `/api/care-records/[itemId]`: edit or delete saved Life Records
- `/api/feedback`: save completion feedback
- `/api/auth/signup`: server-side signup
- `/api/auth/confirm-existing`: confirm an existing auth user

There is intentionally no `/api/handoff` combined-output API in v1.

## Key Files

Client:

- `components/dashboard.tsx`: logged-in module dashboard
- `components/welcome-form.tsx`: Caregiver Handoff auth, intake, and resume behavior
- `components/reflection-chat.tsx`: guided reflection experience
- `components/review-editor.tsx`: regenerate, edit, and save summary
- `components/completion-view.tsx`: final review, feedback, PDF download, and email send
- `components/care-records-workspace.tsx`: Life Records input, extraction review, saved records, and printable/PDF output

Server and domain logic:

- `lib/care-records.ts`: Life Records categories, types, normalization, and fallback extraction helpers
- `lib/care-records-server.ts`: Life Records workspace/item persistence helpers
- `lib/life-records-pdf.ts`: generated Life Records PDF layout
- `lib/summary-generation.ts`: Caregiver Handoff summary generation, normalization, QA, and artifact creation
- `lib/summary-audit.ts`: summary audit and repair helpers
- `lib/summary-persistence.ts`: `summary_facts` and `summary_section_summaries` persistence
- `lib/summary-pdf.ts`: generated Caregiver Handoff PDF layout
- `lib/draft-api.ts`: authenticated browser-to-server draft sync
- `lib/supabase.ts`: server-side Supabase clients and auth token verification

Reference data:

- `benchmarks/summary/fixtures/`: benchmark inputs and expectations
- `supabase/migrations/`: database migrations
- `supabase/schema.sql`: current schema snapshot

## Deployment

The linked Vercel project is `ai-caregiver-app`, and production is [https://ai-caregiver-app.vercel.app](https://ai-caregiver-app.vercel.app).

Before production deployment, run:

```bash
npm run typecheck
npm run care-records:test
npm run summary:test
NEXT_TELEMETRY_DISABLED=1 npx -y node@20 node_modules/next/dist/bin/next build
```

Recommended manual checks before a submission or demo:

- Existing Caregiver Handoff flow works end to end.
- Existing draft resume behavior still works.
- Caregiver Handoff PDF download and email delivery still work.
- Life Records typed extraction works.
- Life Records image/PDF/HEIC extraction works without storing the original file.
- Checked `Save approved records for future editing` persists approved records after reload.
- Unchecked `Save approved records for future editing` keeps approvals only in the current printable output.
- Life Records printable/PDF output is readable and grouped by category.
- `/handoff` and `/api/handoff` return `404`.

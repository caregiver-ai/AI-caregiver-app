# Caregiver Handoff

Caregiver Handoff is a guided intake app that helps family caregivers capture practical care knowledge, save progress across sessions, and produce a caregiver-ready guide in English for the next person supporting the care recipient.

## Tech stack

- Next.js 14 App Router
- React 18 + TypeScript
- Tailwind CSS
- Supabase Auth + Postgres
- OpenAI API for transcription, translation, and summary generation
- Resend for summary email delivery
- Vercel hosting with native Git deployments

## Product flow

1. The caregiver signs in with email and password.
2. The intake screen collects caregiver details, care recipient details, consent, and preferred site language.
3. Draft state is saved locally and, when authenticated, synced to Supabase.
4. The reflection flow asks guided caregiver questions in English, Spanish, or Mandarin.
5. Responses can be typed or recorded with audio.
6. Audio is transcribed and, for Spanish or Mandarin, normalized into English before entering the summary pipeline.
7. The caregiver can revisit earlier prompts, edit responses, and continue an in-progress draft later.
8. The review step generates a caregiver-guide summary, runs QA cleanup, and allows inline editing plus regeneration from the saved answers.
9. The completion step collects feedback and can email the finalized summary.

## Current summary pipeline

The current pipeline is no longer just a simple rewrite pass. It is a structured artifact pipeline with persistence and QA:

1. Source turns are read from `sessions.draft_json.turns`.
2. The model captures atomic facts from the questionnaire input. These facts stay atomic so details are not lost.
3. The app groups related facts into a caregiver-guide layout with section intros, labeled groups, and compact caregiver-ready guidance.
4. The app normalizes and audits the output for section placement, duplicate/noisy bullets, title quality, visible coverage, and missing critical details.
5. The server persists:
   - the rendered summary in `summaries`
   - atomic facts in `summary_facts`
   - section item groups in `summary_section_summaries`
6. Regeneration refreshes these artifacts against the current `source_turns_hash`.
7. The caregiver can edit the summary before final confirmation.

The current output format is a structured JSON summary with:

- `title`
- `overview`
- `sections`
  - optional section `intro`
  - grouped section `blocks`
- `generatedAt`
- `layoutVersion`
- `pipelineVersion`
- `sourceTurnsHash`

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

## Features

- Email/password authentication with resumable drafts
- Local draft storage plus auth-backed server sync
- Multilingual UI: English, Spanish, Mandarin
- Typed and recorded responses
- OpenAI transcription with English normalization for supported non-English audio
- Versioned 7-section, 25-question caregiver questionnaire
- Automatic migration of legacy JSON drafts
- Structured caregiver-guide generation from grouped facts
- One-minute recordings with an automatic cutoff chime
- Summary QA and freshness checks
- Review, edit, and regenerate flow
- Completion flow with feedback capture
- Email delivery of the finalized summary
- Supabase-backed persistence for sessions, summaries, feedback, facts, and section summaries

## Local setup

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

## Required environment variables

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

If `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are missing, the app still runs, but summary email sending is disabled.

## Supabase

Supabase handles:

- email/password authentication
- resumable draft storage
- session metadata
- `draft_json` snapshots, including raw turns and saved summaries
- finalized summary records
- summary facts and section summaries
- feedback

Core tables:

- `users`
- `sessions`
- `summaries`
- `feedback`
- `summary_facts`
- `summary_section_summaries`

Notes:

- The raw source input used by regeneration lives in `sessions.draft_json.turns`.
- `conversation_turns` still exists in the schema, but the current summary regeneration path reads from `draft_json.turns`.

For a new project:

1. Create a Supabase project.
2. Apply `supabase/schema.sql`, or run the migrations in `supabase/migrations/`.
3. Add the Supabase env vars to `.env.local`.

If Supabase is not configured, the app can still keep a local browser draft, but auth-backed resume behavior and shared persistence require Supabase.

## OpenAI

OpenAI handles:

- audio transcription
- Spanish and Mandarin speech translation into English
- caregiver summary generation

If `OPENAI_API_KEY` is missing, the summary route falls back to a lightweight heuristic summary so the app can still run locally.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run summary:test
npm run summary:benchmark
npm run summary:review-cases
```

`summary:test` exercises the questionnaire contract, legacy draft migration, summary routing, and freshness logic directly.

`summary:benchmark` runs the benchmark fixture set against the current server-side summary flow and reports checks for completeness, section placement, duplicate bullets, and transcription noise.

`summary:review-cases` runs the current multi-case review gate against Gavin, Tatiana, Jevon, Joe, Ashley, and the raw Joe Word document. It checks that facts are still captured, grouped guide output is not missing required coverage, duplicate visible bullets stay at zero, and facts do not leak into the wrong visible section.

## Deployments

Vercel deploys the app through native Git integration:

- pushes to `main` create production deploys
- pull requests can create preview deploys

Before production deployment, run:

```bash
npm run summary:test
npm run typecheck
npm run summary:review-cases
vercel build --prod
```

Production promotion should still include human review of Spanish and Mandarin translation behavior plus participant-style UAT, including the full one-minute recording flow on iPhone Safari, Android Chrome, and desktop Chrome.

GitHub Actions is used for Supabase migrations:

- `.github/workflows/supabase-migrations.yml`

Required GitHub repo secret for migrations:

- `SUPABASE_DB_URL`

Use the Supabase session-pooler Postgres connection string for `SUPABASE_DB_URL`.

## Database change workflow

For schema changes:

1. Add a new timestamped SQL file under `supabase/migrations/`.
2. Keep `supabase/schema.sql` aligned with the latest schema snapshot.
3. Push the migration through the normal Git flow.
4. GitHub Actions applies the new migration to Supabase.

Changing only `supabase/schema.sql` is not enough for production.

## Key pages and routes

Pages:

- `app/page.tsx`: intake, auth, and resume entry
- `app/reflection/page.tsx`: guided reflection flow
- `app/review/page.tsx`: summary review and editing
- `app/complete/page.tsx`: completion, feedback, and email send
- `app/update-password/page.tsx`: password reset completion

API routes:

- `app/api/session/route.ts`: initial session creation
- `app/api/draft/route.ts`: auth-backed draft load/save
- `app/api/transcribe/route.ts`: transcription and English normalization
- `app/api/summary/route.ts`: initial summary generation and persistence
- `app/api/summary/regenerate/route.ts`: regenerate from saved turns and persisted facts
- `app/api/summary/save/route.ts`: confirm edited summary and mark the session completed
- `app/api/summary/email/route.ts`: email the finalized summary
- `app/api/feedback/route.ts`: save completion feedback
- `app/api/auth/signup/route.ts`: server-side signup
- `app/api/auth/confirm-existing/route.ts`: confirm an existing auth user

Core client components:

- `components/welcome-form.tsx`: auth, intake, and resume behavior
- `components/reflection-chat.tsx`: guided reflection experience
- `components/review-editor.tsx`: regenerate, edit, and save summary
- `components/completion-view.tsx`: final review, feedback, and email send

Core server logic:

- `lib/summary-generation.ts`: summary generation, normalization, QA, and artifact creation
- `lib/summary-audit.ts`: summary audit and repair helpers
- `lib/summary-persistence.ts`: `summary_facts` and `summary_section_summaries` persistence
- `lib/draft-api.ts`: authenticated browser-to-server draft sync
- `lib/supabase.ts`: server-side Supabase clients and auth token verification

Reference data:

- `benchmarks/summary/fixtures/`: benchmark inputs and expectations
- `supabase/migrations/`: database migrations

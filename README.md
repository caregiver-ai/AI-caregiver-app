# Caregiver Handoff

Caregiver Handoff is a guided intake app that helps caregivers capture what matters most, save progress, and turn responses into a clear English handoff summary for the next caregiver.

## Tech stack

- Next.js 14 App Router
- React + TypeScript
- Tailwind CSS
- Supabase Auth + Postgres
- Gemini API for transcription, translation, and summary generation
- Vercel hosting with native Git deployments

## Current workflow

1. Caregiver signs in with email and password.
2. The intake page collects caregiver and care recipient basics, plus preferred site language.
3. Progress is saved as a draft in Supabase so the user can come back later.
4. The reflection flow asks guided questions in English, Spanish, or Mandarin.
5. Responses can be typed or recorded with audio.
6. Audio can be transcribed and, for Spanish or Mandarin, translated into English before saving.
7. Users can go back to earlier prompts, edit saved answers, or fill in skipped prompts later.
8. The app generates an English summary for review and editing.
9. The final summary and feedback are saved in Supabase.

## Features

- Auth-backed resume flow
- Autosaved intake and reflection drafts
- Multilingual UI: English, Spanish, Mandarin
- Audio recording with Gemini transcription
- English-normalized transcript input for summary generation
- Editable review step before final save
- Supabase-backed persistence for sessions, turns, summaries, and feedback

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
GEMINI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SECRET_KEY=
```

Also supported:

```bash
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TRANSCRIPTION_MODEL=gemini-2.5-flash
```

`SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are interchangeable in the current server code. Only one is required.

## Supabase

Supabase handles:

- email/password authentication
- resumable draft storage
- sessions
- conversation turns
- generated and edited summaries
- feedback

For a new project:

1. Create a Supabase project.
2. Apply the bootstrap schema in `supabase/schema.sql`, or run the migrations in `supabase/migrations/`.
3. Add the Supabase env vars to `.env.local`.

If Supabase is not configured, the app can still keep a local browser draft, but auth-backed persistence and shared resume behavior require Supabase.

## Gemini

Gemini handles:

- audio transcription
- Spanish and Mandarin speech translation into English
- structured summary generation

If `GEMINI_API_KEY` is missing, the summary route falls back to a lightweight heuristic summary so the app can still run locally.

## Deployments

Vercel deploys this app through its native Git integration:

- pushes to `main` create production deploys
- pull requests can create preview deploys

GitHub Actions is only used for Supabase migrations:

- `.github/workflows/supabase-migrations.yml`

Required GitHub repo secret for migrations:

- `SUPABASE_DB_URL`

Use the Supabase session-pooler Postgres connection string for `SUPABASE_DB_URL`.

## Database change workflow

For schema changes:

1. Add a new timestamped SQL file under `supabase/migrations/`.
2. Keep `supabase/schema.sql` in sync with the latest schema snapshot.
3. Push to `main`.
4. GitHub Actions applies the new migration to Supabase.

Changing only `supabase/schema.sql` is not enough for production.

## Key files

- `app/page.tsx`: entry page
- `app/reflection/page.tsx`: guided reflection
- `app/review/page.tsx`: review and edit
- `app/complete/page.tsx`: completion and feedback
- `app/api/draft/route.ts`: auth-backed draft load/save
- `app/api/transcribe/route.ts`: Gemini audio transcription
- `app/api/summary/route.ts`: summary generation
- `components/welcome-form.tsx`: intake and sign-in flow
- `components/reflection-chat.tsx`: editable guided reflection flow
- `supabase/migrations/`: database migrations

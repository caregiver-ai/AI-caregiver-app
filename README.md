# Caregiver Handoff

Guided caregiver intake that turns spoken or typed responses into a structured handoff summary for the next caregiver.

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Supabase for persistence
- Gemini API for structured summary generation
- Vercel deployment via GitHub Actions

## What the app does

1. Clean intake page for caregiver and care recipient basics.
2. Guided reflection with section-based prompts.
3. Optional audio recording with Gemini transcription into editable text.
4. Server-side summary generation that returns structured JSON for review.
5. Editable review screen before final confirmation.
6. Completion screen with saved summary and feedback capture.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env.local
```

3. Add values for Supabase and Gemini.

4. Run the dev server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000).

## Supabase setup

1. Create a Supabase project.
2. Apply `supabase/schema.sql` for one-time bootstrap, or run the baseline migration in `supabase/migrations/`.
3. Add the project URL, anon key, and service role key to `.env.local`.

The app will still run without Supabase credentials by keeping draft data in browser local storage, but server persistence is only active when Supabase is configured.

## Gemini setup

Add `GEMINI_API_KEY` to `.env.local`.

If no Gemini key is present, the `/api/summary` route falls back to a lightweight heuristic summary so the end-to-end prototype still works.

## GitHub automation

This repo now includes two GitHub Actions workflows:

- `.github/workflows/vercel-deploy.yml`: deploys preview builds for pull requests and production builds for pushes to `main`
- `.github/workflows/supabase-migrations.yml`: applies SQL files in `supabase/migrations/` to Supabase on pushes to `main`

Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `SUPABASE_DB_URL`

The `SUPABASE_DB_URL` secret should be a direct Postgres connection string for your Supabase project. The migration workflow records applied files in `internal.schema_migrations`.

## Deploy to Vercel

1. Create or link a Vercel project for this repository.
2. Add the environment variables from `.env.example` in Vercel.
3. Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as GitHub repository secrets.
4. Push to `main` to trigger a production deployment.

## Architecture note

The app uses a thin client/server split:

- Client pages manage the reflection flow, route transitions, editable form state, and local draft persistence for MVP speed.
- Server routes handle session creation, Gemini summary generation, confirmation saves, and feedback writes.
- Supabase stores `users`, `sessions`, `conversation_turns`, `summaries`, and `feedback`.
- The reflection flow is deterministic by design: the client drives the initial prompts and selects follow-ups from a controlled bank with simple category coverage heuristics.

## File highlights

- `app/page.tsx`: welcome page
- `app/reflection/page.tsx`: guided reflection
- `app/review/page.tsx`: review and edit
- `app/complete/page.tsx`: completion and feedback
- `app/api/summary/route.ts`: Gemini summary route
- `supabase/schema.sql`: bootstrap schema snapshot
- `supabase/migrations/`: ordered database migrations for GitHub Actions

## Database change workflow

For future schema updates:

1. Add a new timestamped SQL file under `supabase/migrations/`.
2. Keep `supabase/schema.sql` in sync with the latest schema snapshot.
3. Push to `main` to apply the migration through GitHub Actions.

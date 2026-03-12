# Caregiver Reflection Prototype

Lightweight MVP for the Phase 1 workflow: guided reflection -> AI-assisted structuring -> editable summary -> confirmation and feedback.

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Supabase for persistence
- Gemini API for structured summary generation
- Vercel-ready deployment

## What the prototype does

1. Welcome page with prototype explanation, email capture, and consent checkbox.
2. Guided reflection with a deterministic, app-controlled prompt flow.
3. Up to 3 follow-up questions selected from a seeded prompt bank based on missing categories.
4. Server-side summary generation that requests valid JSON in the required schema.
5. Editable review screen before final confirmation.
6. Completion screen with saved summary, browser PDF export, and feedback.

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
2. Run the SQL in `supabase/schema.sql`.
3. Add the project URL, anon key, and service role key to `.env.local`.

The app will still run without Supabase credentials by keeping draft data in browser local storage, but server persistence is only active when Supabase is configured.

## Gemini setup

Add `GEMINI_API_KEY` to `.env.local`.

If no Gemini key is present, the `/api/summary` route falls back to a lightweight heuristic summary so the end-to-end prototype still works.

## Deploy to Vercel

1. Push this app to the correct GitHub repository.
2. Import the repo into Vercel.
3. Set the environment variables from `.env.example`.
4. Deploy.

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
- `supabase/schema.sql`: database schema

## Note about the repo

The local folder you pointed to was empty when I started, and its existing git `origin` was set to a different repository (`Olina-birthday-website`). I left git remote configuration unchanged.

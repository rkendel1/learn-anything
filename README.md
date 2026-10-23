# Learn Anything

A working MVP scaffold for a personal learning companion. Users can choose any topic, state their starting knowledge and desired depth, set a daily time budget, answer two lightweight calibration questions, and generate a seven-day curriculum. They can also request recommendations or surprise topics and track lesson completion.

## Stack

- Next.js + React + TypeScript
- Convex for persistent journeys, curriculum versions, and learning evidence
- OpenAI-compatible Chat Completions API for optional personalized generation
- Deterministic fallback generation so the app remains demonstrable before adding an API key

## Run it

Requirements: Node.js 20.9+ and an npm account-free local development environment.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Convex project and start its dev deployment:

   ```bash
   npx convex dev
   ```

   Follow the CLI prompts. It will generate `convex/_generated` and a deployment URL.

3. In a second terminal, create `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   Set `NEXT_PUBLIC_CONVEX_URL` to the deployment URL printed by Convex. Restart the Next.js process whenever this value changes.

4. Start the web app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

5. Optional: enable AI-powered generation by setting the key in the **Convex deployment environment** (not only in `.env.local`):

   ```bash
   npx convex env set OPENAI_API_KEY your_key
   npx convex env set OPENAI_MODEL gpt-4.1-mini
   ```

   The fallback mode still lets you exercise the complete product flow without a model key. Fallback curricula are clearly marked as starter plans and have no verified sources.

## Current working flow

1. Create a journey with topic, starting knowledge, depth, daily time, and optional goal.
2. Generate two calibration questions.
3. Submit responses.
4. Generate and validate a seven-day plan.
5. Open daily lessons, enter a reflection/answer, and mark them complete.
6. Ask for recommended or surprise topics and start another journey.
7. Revisit prior journeys from the learning trail.

## Important MVP boundaries

- This is a **single-user prototype**. It has no sign-in or per-user authorization yet. Do not expose its Convex deployment publicly or use it for sensitive data until authentication and ownership checks are added.
- The MVP validator checks schema-critical fields, lesson count, depth/time consistency, and lesson time limits. It is not a substitute for robust source retrieval, factual verification, or pedagogical review.
- OpenAI generation is optional. Without a key, the application uses deterministic fallback content.
- The source retrieval pipeline, formal assessment scoring, mid-week curriculum versioning UI, and scheduled preparation of the next week are not implemented yet.
- The UI is a real interaction scaffold, not a production-ready accessibility or security audit.

## Suggested next steps

1. Add Convex Auth and enforce ownership in every query/mutation/action.
2. Add source retrieval + URL verification before generating sourced curricula.
3. Store lesson content separately from the curriculum plan and add curriculum validation reports.
4. Add evaluation of written answers against versioned rubrics.
5. Add durable scheduled jobs to prepare the next week and retry failed generation safely.
6. Add versioned replanning when depth or scope changes mid-week.

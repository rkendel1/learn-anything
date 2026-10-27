# Learn Anything

A working MVP scaffold for a personal learning companion. Users can choose any topic, state their starting knowledge and desired depth, set a daily time budget, answer two lightweight calibration questions, and generate a seven-day curriculum. They can also request recommendations or surprise topics and track lesson completion.

## Stack

- Next.js + React + TypeScript
- Convex for persistent journeys, curriculum versions, and learning evidence
- AI SDK + Vercel AI Gateway for structured planning and lesson writing
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

3. Generate the auth signing keys and set them on that deployment:

   ```bash
   npm run auth:keys
   cat .auth/jwt_private_key.pem | npx convex env set --force JWT_PRIVATE_KEY
   cat .auth/jwks.json | npx convex env set --force JWKS
   ```

   `.auth/` holds the RS256 key pair and is git-ignored. The keys go on the **Convex deployment**, not in `.env.local`; pass `--prod` or `--deployment <name>` to target another deployment. Re-running `npm run auth:keys -- --force` rotates the pair and signs every user out.

4. In a second terminal, create `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   Set `NEXT_PUBLIC_CONVEX_URL` to the deployment URL printed by Convex. Restart the Next.js process whenever this value changes.

5. Start the web app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 and create an account with email and password.

6. Enable the backend agent in the **Convex deployment environment**, not just the Next.js/Vercel environment:

   ```bash
   npx convex env set AI_GATEWAY_API_KEY
   npx convex env set AI_MODEL openai/o4-mini
   npx convex env set AI_REASONING_MODEL openai/o4-mini
   ```

   The first command prompts for the secret so it does not appear in shell history. Model overrides are optional. Use `--prod` for the production Convex deployment. The key is read only by server-side actions. See [AI Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok).

7. Deploy the Convex functions with `npx convex deploy` before releasing the updated web app. Deploying Next.js alone does not publish Convex code. Keep `NEXT_PUBLIC_CONVEX_URL` pointed at the corresponding Convex deployment.

## Authentication and ownership

Sign-in uses [Convex Auth](https://labs.convex.dev/auth) with its email/password provider. `convex/auth.config.ts` validates tokens against `CONVEX_SITE_URL` plus the `JWT_PRIVATE_KEY`/`JWKS` pair above, and `convex/authz.ts` is the single place that resolves the current user and checks journey ownership.

- Every public query, mutation, and action requires a signed-in user.
- A journey stores its `ownerId`; child records (contracts, versions, evidence, proposals) are reachable only through an owned journey.
- Missing and unauthorized journeys return the same "Learning journey not found." error so ids cannot be probed.
- `listJourneys` only returns the signed-in user's journeys.

### Claiming pre-auth journeys

Journeys created before auth was added have no `ownerId`, so they are hidden from every user. After creating your account, claim them once from the CLI/dashboard with the internal mutation:

```bash
npx convex run learn:claimLegacyJourneys '{"userId":"<your users document id>"}'
```

The mutation is internal-only and refuses unknown users. Run it deliberately: it assigns every unowned journey to the given user.


## Backend content agent

After calibration, the agent first builds a structured seven-day curriculum from the requested topic, knowledge level, depth, daily time budget, goal, and answers. A separate writer then produces each lesson's actual teaching text, worked example, and practice activity using the full week for context. Only the complete course is published through the existing curriculum-version mutation.

Both stages use schema-validated AI SDK outputs. Additional checks reject missing or duplicate ids, broken objective/assessment references, future lesson prerequisites, incorrect totals, and time-budget violations. Continuation journeys use the same pipeline. Sources are deliberately empty: this is not a retrieval or fact-checking agent.

Generation makes eight sequential model requests and can take several minutes. Calls are cancellable and have bounded retries/timeouts. On initial-course failure, the app explicitly labels the deterministic starter outline instead of presenting it as AI-written teaching content. Use **Regenerate learning content** before completing any lessons to retry; regeneration is disabled once progress exists. A failed continuation does not publish a partial proposal.

Run `npm test`, `npm run typecheck`, and `npm run build`. Tests cover contract validation and the planner/writer orchestration using mock models; they do not make billable model calls. A live end-to-end check requires a configured Convex deployment and AI Gateway key.

## Current working flow

1. Create a journey with topic, starting knowledge, depth, daily time, and optional goal.
2. Generate two calibration questions.
3. Submit responses.
4. Generate and validate a seven-day plan.
5. Open daily lessons, enter a reflection/answer, and mark them complete.
6. Ask for recommended or surprise topics and start another journey.
7. Revisit prior journeys from the learning trail.

## Important MVP boundaries

- Sign-in is email/password through Convex Auth. Each journey is owned by the signed-in user and enforced on the server; the UI is not the security boundary.
- The MVP validator checks schema-critical fields, lesson count, depth/time consistency, and lesson time limits. It is not a substitute for robust source retrieval, factual verification, or pedagogical review.
- AI generation is optional. Without a working backend key, initial journeys show a labeled starter outline; generating a continuation requires the model.
- The source retrieval pipeline, formal assessment scoring, mid-week curriculum versioning UI, and scheduled preparation of the next week are not implemented yet.
- The UI is a real interaction scaffold, not a production-ready accessibility or security audit.

## Suggested next steps

1. Add rate limits to the billable AI actions and password-reset/verification flows.
2. Add source retrieval + URL verification before generating sourced curricula.
3. Store lesson content separately from the curriculum plan and add curriculum validation reports.
4. Add evaluation of written answers against versioned rubrics.
5. Add durable scheduled jobs to prepare the next week and retry failed generation safely.
6. Add versioned replanning when depth or scope changes mid-week.

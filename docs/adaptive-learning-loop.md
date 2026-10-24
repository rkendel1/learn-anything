# Single-user adaptive learning loop

## Durable contract and traceability

Journey creation atomically stores a version-1 `learningContracts` record. The contract retains the original goal, one to four original questions/capabilities, declared knowledge/depth, seven scheduled days, daily budget, and stable measurable objective/question IDs. Both planner and writer receive this contract and baseline evidence. Objectives cannot be renamed or replaced during planning/adaptation. In-place goal editing is intentionally unavailable: start or accept an explicitly reviewed follow-on journey instead of rewriting history.

The trace is contract question → objective → curriculum version/lesson/activity → assessment prompt and rubric → immutable assessment attempt → per-objective outcome. Each evaluated attempt includes criterion-level quoted response evidence, explanations, next action and (when needed) persisted remediation teaching, worked example and a new practice prompt. Retrying targeted practice creates a child attempt linked to the original version and rubric. Legacy `learningEvidence` records remain untouched and are **not** upgraded into proof of learning.

New typed/indexed tables: `learningContracts`, `assessmentAttempts`, `adaptationRecords`, `objectiveOutcomes`. Existing journey records gain only optional `startedLessonIds`. Existing curriculum/calibration payload fields remain permissive for compatibility; new writes are application-validated. There is no destructive migration or reset.

## Precise states

These are objective states derived from persisted activity and assessment records, not a model confidence score:

- `not_started`: no linked lesson started/completed and no assessment attempt.
- `in_progress`: a linked lesson opened, without completion or an assessment attempt.
- `awaiting_assessment`: linked activity completed or evaluator unavailable, without valid assessed understanding.
- `needs_practice`: latest valid non-diagnostic assessment is developing or insufficient evidence.
- `demonstrated`: latest assessment meets every objective-specific rubric criterion with quoted evidence.
- `mastered`: latest assessment passes and at least two distinct assessment prompts passed since the last demonstrated gap. This is an operational course label, not a guarantee of long-term retention.

A diagnostic alone can record baseline `unknown`, `not_demonstrated`, `developing`, or `demonstrated`; it never grants achievement/mastery. Blank lesson answers produce no assessment evidence. Evaluator failures preserve the response with `unavailable`, without a passing result. Completing a day is an activity-only event; it neither assesses nor automatically advances objectives.

Journey lifecycle remains `calibrating` → `planning` → `active` → `completed`. `completed` means scheduled lessons finished, **not** that goals were achieved. Completion materializes typed per-objective outcomes; further assessments update them without erasing attempts. Final reports distinguish achieved, partially achieved, not demonstrated and not assessed. Targeted practice and follow-on proposals remain available after completion.

## Publication and adaptation boundaries

Curricula require seven ordered days, valid unique IDs, objective and assessment coverage, valid activity references, prerequisite ordering, nonempty teaching/practice/rubrics, and daily/total workload constraints. The writer cannot change stable activity references. Sources must remain empty: this application does not pretend that generated teaching is researched or verified.

Unsafe generic fallback publication was removed, not relabeled. Generation/validation failure returns a retryable error and leaves the prior valid curriculum in place (or leaves setup pending). No generic outline is published as a personalized course.

Adaptation is explicitly requested with “Adapt upcoming lessons”. Only current assessed gaps justify it. The commit mutation rechecks the active version and latest evidence, validates the complete proposed curriculum, and protects completed, opened, and attempted lessons. Original questions/goals, objective definitions, rubrics, and stable activity references remain unchanged. The actual validated lesson diff determines change count; no-op changes do not mint versions. Accepted/rejected/no-op records retain rationale, triggering evidence and actual changes; rejected proposals cannot replace the active curriculum.

## Existing records

Legacy journeys remain readable. On starting/completing/assessing work, an idempotent `legacy_snapshot` contract retains existing objective IDs and marks its origin explicitly. Existing self-report calibration is not assessed retroactively. Legacy submitted setup can produce a new valid plan with unknown baseline. Invalid old plans cannot be adapted under the stronger validator, but completion/assessments remain possible and follow-on planning uses the current pipeline. Prepared proposals that predate contract validation must be dismissed and regenerated if they fail validation.

## Verification and rollout

Deterministic tests use the existing Node/tsx suite (including AI SDK mock planner/writer responses) plus Convex's in-memory test harness. Backend acceptance tests execute real actions, queries and mutations from creation through final outcomes with mocked model responses, including remediation, safe adaptation, unresolved goals, stale proposals and legacy compatibility. No live model calls are used. `npm run test:backend` is backend/API end-to-end coverage, **not a browser test**.

Commands:

```sh
npm ci
npm run typecheck
npm test
npm run test:backend
npm run lint
npm run build
```

Before a live UI acceptance run, deploy this additive schema/backend to the intended Convex development/preview deployment using the project's normal authenticated workflow; configure its AI Gateway model credentials there and point the Vercel preview at that same backend. Never point a new frontend at an old backend lacking these functions. This PR does not rebind or deploy a Convex backend. Local code generation could not run without `CONVEX_DEPLOYMENT`; the existing generated API/data-model types derive the changed functions/tables and pass TypeScript checks, but live push/codegen validation is still required in the connected environment.

Known limits: content/rubric correctness still depends on model quality; workload validation is an estimate, not a timer. Progress views read the latest 1,000 attempts plus baseline records, latest 30 adaptations, and latest 100 journeys; persisted older records are not deleted. There is no new browser-test infrastructure or live-model/browser acceptance verification in this PR. No authentication, external agent, database, orchestration framework, or unrelated dashboard was added.

### Checks actually run for this PR

- `npm ci`: passed.
- `npm run typecheck`: passed.
- `npm test`: 28 passed, 0 failed (original planner/writer tests plus new core invariants).
- `npm run test:backend`: 14 passed, 0 failed (mocked-model Convex acceptance/integration tests).
- `npm run lint`: passed.
- `npm run build`: passed; Next.js warns that its framework-specific ESLint plugin is not configured. The configured TypeScript ESLint check runs separately and passes.
- `git diff --check`: passed.
- `npx convex codegen`: blocked/failed because `CONVEX_DEPLOYMENT` is not configured. No deployment was changed.
- `npm audit --json`: reports two existing findings (one high, one moderate) in Next.js/PostCSS. The original and resulting lockfiles both have Next.js 15.5.28/PostCSS 8.4.31; these dependencies were not upgraded in this feature PR.

/// <reference types="vite/client" />
import {beforeEach, expect, test, vi} from "vitest";
import {convexTest} from "convex-test";
import schema from "./schema";
import {api, internal} from "./_generated/api";
import {fixture} from "../tests/fixtures";
import {validatePlan, type LearnerInput, type Curriculum} from "./learningCore";

const mode = vi.hoisted(() => ({assessment: "normal", adaptation: "change", plannerInvalid: false}));
vi.mock("./model", () => ({
  learningModel: () => "mock",
  generateJson: async ({system, input, fallback}: {system: string; input: any; fallback: () => unknown}) => {
    if (system.startsWith("Create one lightweight")) return {usedFallback: false, value: input.objectives.map((o: any, i: number) => ({id: `diagnostic${i+1}`, objectiveId: o.id, prompt: `Explain equal parts to answer ${input.questions[i]?.text}`, concept: "Equal parts", expectedAnswer: "Equal-sized parts of a whole", rubric: [{criterion: "Equal parts", expectedEvidence: "Parts must be equal"}]}))};
    if (system.startsWith("Evaluate only")) {
      if (mode.assessment === "unavailable") return {usedFallback: true, value: fallback()};
      if (mode.assessment === "invalid") return {usedFallback: false, value: {outcome: "mastered"}};
      const met = input.response.includes("equal");
      return {usedFallback: false, value: {objectiveId: input.objectiveId, outcome: met ? "demonstrated" : "developing", criteria: input.rubric.map((r: any) => ({criterion: r.criterion, met, evidence: met ? "equal" : "", explanation: met ? "Equal size identified." : "Equal sizes are missing."})), explanation: met ? "You demonstrated equal parts." : "Parts must have equal size, not just any two pieces.", nextAction: met ? "Try transfer practice." : "Practice equal partitioning.", remediation: met ? null : {instruction: "A half is one of TWO EQUAL parts; number of pieces alone is insufficient.", workedExample: "Two equal 50g pieces of a 100g bar are halves; 20g and 80g pieces are not.", prompt: "A 120g bar is cut into 40g and 80g. Are these halves? Explain, then show a correct split."}}};
    }
    if (system.startsWith("Adapt ONLY")) {
      const lessons = structuredClone(input.future);
      if (mode.adaptation === "invalid") lessons[0].objectiveIds = ["unknown"];
      else if (mode.adaptation !== "noop") lessons[0].purpose += " — revisit equal-sized pieces with a new example";
      return {usedFallback: false, value: {lessons, rationale: "Assessment showed unequal parts misconception."}};
    }
    return {usedFallback: true, value: fallback()};
  },
}));
vi.mock("./curriculumAgent", () => ({
  createLearningContent: async (input: LearnerInput) => {
    const p = fixture();
    p.topic = input.topic; p.learnerModel.declaredStartingKnowledge = input.startingKnowledge; p.learnerModel.desiredDepth = input.desiredDepth; p.learnerModel.dailyMinutes = input.dailyMinutes;
    p.objectives = input.contract!.objectives.map(o => ({id: o.id, statement: o.statement, assessmentMethod: "Explain with a worked example", prerequisiteObjectiveIds: []}));
    p.assessments = p.objectives.map(o => ({id: `check-${o.id}`, objectiveIds: [o.id], kind: "application", prompt: "Are any two pieces of a whole halves? Explain.", rubric: [{criterion: "Equal parts", expectedEvidence: "Parts must be equal"}], passingCriteria: "Correct equal-parts reasoning"}));
    p.lessons.forEach(l => {
      l.objectiveIds = p.objectives.map(o => o.id); l.activities[0].objectiveIds = l.objectiveIds; l.assessmentIds = p.assessments.map(a => a.id);
      l.lessonBody = JSON.stringify(input.calibrationAnswers ?? []).includes('"outcome":"demonstrated"') ? "Apply equal-part reasoning to unequal pieces in advanced examples." : "Start with equal parts: split a whole into two same-sized pieces. Each is one half.";
      l.estimatedMinutes = input.dailyMinutes;
    });
    p.totalEstimatedMinutes = input.dailyMinutes * 7;
    if (mode.plannerInvalid) p.lessons[0].objectiveIds = ["invalid"];
    return validatePlan(p, input);
  },
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
/**
 * Seeds a signed-in user and returns an accessor bound to that identity, so
 * public functions see the same owner the app's sign-in flow would produce.
 */
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "learner@example.com" }));
  return { t: t.withIdentity({ subject: userId }), userId };
}
type Seeded = Awaited<ReturnType<typeof setup>>;
beforeEach(() => {mode.assessment = "normal"; mode.adaptation = "change"; mode.plannerInvalid = false;});
async function journey(t: Seeded["t"], questions = ["Why do halves have to be equal?"], response = "I am not sure") {
  const id = await t.mutation(api.learn.createJourney, {topic: "Fractions", startingKnowledge: "new", desiredDepth: "understand", dailyMinutes: 10, goal: "Explain equal fractions", originalQuestions: questions});
  const qs = await t.action(api.generation.generateCalibration, {journeyId: id});
  await t.mutation(api.learn.submitCalibration, {journeyId: id, answers: Object.fromEntries(qs.map(q => [q.id, response]))});
  await t.action(api.generation.generateCurriculum, {journeyId: id});
  return id;
}
test("end-to-end: contract → diagnostic → teaching → incorrect answer → remediation → safe adaptation → final report", async () => {
  const { t } = await setup(); const id = await journey(t);
  const before = await t.query(internal.learn.getLoopContext, {journeyId: id});
  await t.mutation(api.learn.startLesson, {journeyId: id, lessonId: "day1"});
  expect((await t.query(api.learn.getLearningProgress, {journeyId: id})).objectives[0].state).toBe("in_progress");
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Any two pieces are halves"});
  await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: "day1"});
  let progress = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(progress.objectives[0].state).toBe("needs_practice");
  const failed = progress.attempts.find(a => a.kind === "assessment")!;
  expect(failed.evaluation?.remediation?.prompt).not.toBe(failed.prompt);
  const adapted = await t.action(api.generation.adaptUpcomingLessons, {journeyId: id, lessonId: "day1"});
  expect(adapted.changed).toBe(1);
  const after = await t.query(internal.learn.getLoopContext, {journeyId: id});
  expect(after.contract).toEqual(before.contract);
  expect((after.version!.curriculum as Curriculum).lessons[0]).toEqual((before.version!.curriculum as Curriculum).lessons[0]);
  expect(after.attempts.find(a => a._id === failed._id)).toEqual(failed);
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "They must be equal, so cut into 60g and 60g.", parentAttemptId: failed._id});
  for (let day = 2; day <= 7; day++) await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: `day${day}`});
  progress = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(progress.final).toBe(true); expect(progress.allGoalsAchieved).toBe(true);
  expect(progress.objectives[0].question).toBe(before.contract!.contract.questions[0].text);
  expect(progress.objectives[0].state).toBe("demonstrated");
  expect(progress.objectives[0].evidence.some(a => a.kind === "remediation" && a.parentAttemptId === failed._id)).toBe(true);
  const persisted = await t.run(ctx => ctx.db.query("objectiveOutcomes").withIndex("by_journeyId_and_objectiveId", q => q.eq("journeyId", id)).collect());
  expect(persisted[0].outcome).toBe("achieved"); expect(persisted[0].evidenceIds).toHaveLength(3);
});
test("different diagnostic evidence changes planned instruction, not original objectives", async () => {
  const { t } = await setup(); const first = await journey(t); const second = await journey(t, undefined, "Two equal pieces");
  const a = await t.query(internal.learn.getLoopContext, {journeyId: first}); const b = await t.query(internal.learn.getLoopContext, {journeyId: second});
  expect(a.version!.curriculum.lessons[0].lessonBody).not.toBe(b.version!.curriculum.lessons[0].lessonBody);
  expect(a.contract!.contract.objectives).toEqual(b.contract!.contract.objectives);
});
test("completion without an answer creates no assessment or mastery, even at journey end", async () => {
  const { t } = await setup(); const id = await journey(t);
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: ""});
  for (let day = 1; day <= 7; day++) await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: `day${day}`});
  const progress = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(progress.final).toBe(true); expect(progress.allGoalsAchieved).toBe(false);
  expect(progress.attempts.every(a => a.kind === "baseline")).toBe(true);
  expect(progress.objectives[0].outcome).toBe("not assessed");
});
for (const failure of ["invalid", "unavailable"]) test(`${failure} evaluator never records passing evidence`, async () => {
  const { t } = await setup(); const id = await journey(t); mode.assessment = failure;
  const result = await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "A very long answer with equal repeated many times"});
  expect(result.result).toBe("unavailable");
  const p = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(p.attempts.at(-1)?.status).toBe("unavailable"); expect(p.objectives[0].outcome).toBe("not assessed");
});
test("an objective assessment cannot grant an unrelated objective achievement", async () => {
  const { t } = await setup(); const id = await journey(t, ["Why equal parts?", "How do you add halves?"]);
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "The pieces must be equal", objectiveId: "objective1", assessmentId: "check-objective1"});
  for (let day = 1; day <= 7; day++) await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: `day${day}`});
  const p = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(p.objectives[0].outcome).toBe("achieved"); expect(p.objectives[1].outcome).toBe("not assessed"); expect(p.allGoalsAchieved).toBe(false);
});
for (const adaptation of ["invalid", "noop"]) test(`${adaptation} adaptation retains active version and evidence`, async () => {
  const { t } = await setup(); const id = await journey(t);
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Any two pieces"});
  await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: "day1"});
  const before = await t.query(internal.learn.getLoopContext, {journeyId: id}); mode.adaptation = adaptation;
  const result = await t.action(api.generation.adaptUpcomingLessons, {journeyId: id, lessonId: "day1"});
  const after = await t.query(internal.learn.getLoopContext, {journeyId: id});
  expect(result.changed).toBe(0); expect(after.version).toEqual(before.version); expect(after.attempts).toEqual(before.attempts); expect(after.contract).toEqual(before.contract);
  expect(after.adaptations[0].status).toBe(adaptation === "invalid" ? "rejected" : "unchanged");
});
test("generation failure cannot publish a generic fallback as personalized content", async () => {
  const { t } = await setup(); const id = await t.mutation(api.learn.createJourney, {topic: "Fractions", startingKnowledge: "new", desiredDepth: "understand", dailyMinutes: 10});
  const qs = await t.action(api.generation.generateCalibration, {journeyId: id});
  await t.mutation(api.learn.submitCalibration, {journeyId: id, answers: {[qs[0].id]: "Unsure"}});
  mode.plannerInvalid = true;
  await expect(t.action(api.generation.generateCurriculum, {journeyId: id})).rejects.toThrow("No new plan was published");
  expect((await t.query(internal.learn.getLoopContext, {journeyId: id})).version).toBeNull();
});
test("legacy journeys stay hidden until claimed, then can complete without fabricated history", async () => {
  const { t, userId } = await setup();
  const id = await t.run(async ctx => {
    const id = await ctx.db.insert("journeys", {topic: "Fractions", startingKnowledge: "new", desiredDepth: "understand", dailyMinutes: 10, status: "active", completedLessonIds: [], createdAt: 1, updatedAt: 1});
    const legacy = fixture(); legacy.lessons.forEach(l => l.activities.forEach(a => {delete (a as {id?: string}).id;}));
    await ctx.db.insert("curriculumVersions", {journeyId: id, version: 1, status: "published", curriculum: legacy, createdAt: 1});
    return id;
  });
  expect(await t.query(api.learn.listJourneys, {})).toHaveLength(0);
  expect(await t.query(api.learn.getJourney, {journeyId: id})).toBeNull();
  await expect(t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: "day1"})).rejects.toThrow("Learning journey not found.");
  expect(await t.mutation(internal.learn.claimLegacyJourneys, {userId})).toBe(1);
  expect((await t.query(api.learn.listJourneys, {}))[0]._id).toBe(id);
  await t.mutation(internal.learn.ensureContract, {journeyId: id});
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Two equal pieces"});
  for (let day = 1; day <= 7; day++) await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: `day${day}`});
  const p = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(p.contract?.origin).toBe("legacy_snapshot"); expect(p.objectives[0].baseline).toBe("unknown"); expect(p.final).toBe(true); expect(p.objectives[1].outcome).toBe("not assessed");
});
test("another signed-in user cannot read, complete, or adapt someone else's journey", async () => {
  const { t } = await setup();
  const id = await journey(t);
  const outsiderId = await t.run((ctx) => ctx.db.insert("users", { email: "outsider@example.com" }));
  const outsider = t.withIdentity({ subject: outsiderId });
  expect(await outsider.query(api.learn.listJourneys, {})).toHaveLength(0);
  expect(await outsider.query(api.learn.getJourney, {journeyId: id})).toBeNull();
  await expect(outsider.query(api.learn.getLearningProgress, {journeyId: id})).rejects.toThrow("Learning journey not found.");
  await expect(outsider.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: "day1"})).rejects.toThrow("Learning journey not found.");
  await expect(outsider.mutation(api.learn.startLesson, {journeyId: id, lessonId: "day1"})).rejects.toThrow("Learning journey not found.");
  await expect(outsider.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Any two pieces"})).rejects.toThrow("Learning journey not found.");
  await expect(outsider.action(api.generation.adaptUpcomingLessons, {journeyId: id, lessonId: "day1"})).rejects.toThrow("Learning journey not found.");
  await expect(outsider.action(api.generation.prepareNextJourney, {journeyId: id})).rejects.toThrow("Learning journey not found.");
});
test("anonymous clients cannot create or list journeys", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.learn.listJourneys, {})).toHaveLength(0);
  await expect(t.mutation(api.learn.createJourney, {topic: "Fractions", startingKnowledge: "new", desiredDepth: "understand", dailyMinutes: 10})).rejects.toThrow("Sign in to continue.");
  await expect(t.action(api.generation.recommendTopics, {recentTopics: [], mode: "recommend"})).rejects.toThrow("Sign in to continue.");
});
test("follow-on acceptance keeps the completed journey and unresolved work intact", async () => {
  const { t } = await setup(); const id = await journey(t);
  for (let day = 1; day <= 7; day++) await t.mutation(api.learn.markLessonComplete, {journeyId: id, lessonId: `day${day}`});
  const before = await t.query(internal.learn.getLoopContext, {journeyId: id});
  const proposal = await t.action(api.generation.prepareNextJourney, {journeyId: id});
  const next = await t.mutation(api.learn.acceptJourneyProposal, {proposalId: proposal.proposalId as any});
  expect(next).not.toBe(id);
  const after = await t.query(internal.learn.getLoopContext, {journeyId: id});
  expect(after).toEqual(before);
  const following = await t.query(internal.learn.getLoopContext, {journeyId: next});
  expect(following.contract?.origin).toBe("original"); expect(following.attempts).toHaveLength(0);
  expect(following.contract?.contract.questions).toEqual(before.contract?.contract.questions);
});
test("legacy submitted setup can generate a contract-linked plan without inventing diagnostic evidence", async () => {
  const { t, userId } = await setup();
  const id = await t.run(ctx => ctx.db.insert("journeys", {ownerId: userId, topic: "Fractions", startingKnowledge: "some", desiredDepth: "understand", dailyMinutes: 10, status: "planning", calibrationQuestions: [{id: "old", prompt: "What interests you?"}], calibrationAnswers: {old: "Numbers"}, completedLessonIds: [], createdAt: 1, updatedAt: 1}));
  await t.action(api.generation.generateCurriculum, {journeyId: id});
  const p = await t.query(api.learn.getLearningProgress, {journeyId: id});
  expect(p.objectives[0].baseline).toBe("unknown"); expect(p.attempts).toHaveLength(0);
});
test("a stale adaptation cannot overwrite a newer version", async () => {
  const { t } = await setup(); const id = await journey(t);
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Any two pieces"});
  const before = await t.query(internal.learn.getLoopContext, {journeyId: id});
  await t.action(api.generation.adaptUpcomingLessons, {journeyId: id, lessonId: "day1"});
  const active = await t.query(internal.learn.getLoopContext, {journeyId: id});
  const result = await t.mutation(internal.learn.commitAdaptation, {journeyId: id, previousVersionId: before.version!._id, curriculum: before.version!.curriculum, rationale: "Stale result", evidenceIds: before.attempts.filter(a => a.kind === "assessment").map(a => a._id), currentLessonId: "day1"});
  expect(result.ok).toBe(false);
  expect((await t.query(internal.learn.getLoopContext, {journeyId: id})).version).toEqual(active.version);
});
test("a gap resolved during planning cannot trigger a stale adaptation", async () => {
  const { t } = await setup(); const id = await journey(t);
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Any two pieces"});
  const before = await t.query(internal.learn.getLoopContext, {journeyId: id});
  await t.action(api.generation.evaluateAnswer, {journeyId: id, lessonId: "day1", response: "Two equal pieces"});
  const proposed = structuredClone(before.version!.curriculum); proposed.lessons[1].purpose += " obsolete gap";
  const result = await t.mutation(internal.learn.commitAdaptation, {journeyId: id, previousVersionId: before.version!._id, curriculum: proposed, rationale: "Stale assessed gap", evidenceIds: before.attempts.filter(a => a.kind === "assessment").map(a => a._id), currentLessonId: "day1"});
  expect(result.ok).toBe(false);
  expect((await t.query(internal.learn.getLoopContext, {journeyId: id})).version).toEqual(before.version);
});

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { makeContract, validatePlan, safeAdaptation, objectiveOutcome, validateEvaluation, type Curriculum } from "./learningCore";
import { diagnosticValue, evaluationValue, rubricValue } from "./learningValidators";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

export const listJourneys = query({
  args: {},
  handler: async (ctx) => {
    const journeys = await ctx.db.query("journeys").withIndex("by_updated").order("desc").take(100);
    return await Promise.all(journeys.map(async (journey) => {
      const latest = await ctx.db.query("curriculumVersions")
        .withIndex("by_journey_version", (q) => q.eq("journeyId", journey._id))
        .order("desc").first();
      return { ...journey, curriculum: latest?.curriculum ?? null, curriculumVersionId: latest?._id ?? null };
    }));
  }
});

export const getJourney = query({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) return null;
    const versions = await ctx.db.query("curriculumVersions")
      .withIndex("by_journey_version", (q) => q.eq("journeyId", args.journeyId))
      .order("desc").take(100);
    return { ...journey, curriculum: versions[0]?.curriculum ?? null, curriculumVersion: versions[0]?.version ?? null };
  }
});

export const createJourney = mutation({
  args: {
    topic: v.string(),
    startingKnowledge: v.union(v.literal("new"), v.literal("some"), v.literal("experienced"), v.literal("expert")),
    desiredDepth: v.union(v.literal("explore"), v.literal("understand"), v.literal("deep"), v.literal("master")),
    dailyMinutes: v.number(),
    goal: v.optional(v.string()),
    originalQuestions: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    const topic = args.topic.trim();
    if (!topic) throw new Error("Enter a topic to learn.");
    if (topic.length > 160) throw new Error("Keep the topic under 160 characters.");
    if (![5, 10, 15, 30].includes(args.dailyMinutes)) throw new Error("Choose a supported daily time budget.");
    const now = Date.now();
    const { originalQuestions, ...fields } = args;
    const contract = makeContract({...fields, topic}, originalQuestions);
    const id = await ctx.db.insert("journeys", {
      ...fields, topic, status: "calibrating", completedLessonIds: [], createdAt: now, updatedAt: now
    });
    await ctx.db.insert("learningContracts", {journeyId: id, contract, origin: "original", createdAt: now});
    return id;
  }
});

export const saveCalibration = internalMutation({
  args: { journeyId: v.id("journeys"), questions: diagnosticValue },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) throw new Error("Learning journey not found.");
    const contract = await ctx.db.query("learningContracts").withIndex("by_journeyId", q => q.eq("journeyId", args.journeyId)).first();
    if (!contract || new Set(args.questions.map(q => q.id)).size !== args.questions.length || args.questions.length !== contract.contract.objectives.length || contract.contract.objectives.some(o => !args.questions.some(q => q.objectiveId === o.id))) throw new Error("Diagnostic does not cover the learning contract.");
    if (journey.status !== "calibrating" || journey.calibrationAnswers) throw new Error("Diagnostic already submitted.");
    await ctx.db.patch(args.journeyId, {
      calibrationQuestions: args.questions,
      status: "calibrating",
      updatedAt: Date.now()
    });
  }
});

export const submitCalibration = mutation({
  args: { journeyId: v.id("journeys"), answers: v.record(v.string(), v.string()) },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) throw new Error("Learning journey not found.");
    if (journey.status !== "calibrating") throw new Error("Setup is already complete.");
    const questions = journey.calibrationQuestions as {id: string}[] | undefined;
    if (!questions?.length || Object.keys(args.answers).some(id => !questions.some(q => q.id === id))) throw new Error("Generate diagnostic questions first.");
    await ctx.db.patch(args.journeyId, {
      calibrationAnswers: args.answers,
      status: "planning",
      updatedAt: Date.now()
    });
    await ctx.db.insert("learningEvidence", {
      journeyId: args.journeyId,
      lessonId: "calibration",
      kind: "calibration_response",
      response: JSON.stringify(args.answers),
      createdAt: Date.now()
    });
  }
});

export const publishCurriculum = internalMutation({
  args: { journeyId: v.id("journeys"), curriculum: v.any() },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) throw new Error("Learning journey not found.");
    const previous = await ctx.db.query("curriculumVersions")
      .withIndex("by_journey_version", (q) => q.eq("journeyId", args.journeyId))
      .order("desc").first();
    const attempted = await ctx.db.query("assessmentAttempts").withIndex("by_journeyId", q => q.eq("journeyId", args.journeyId)).take(1000);
    if (journey.completedLessonIds.length || attempted.some(a => a.kind !== "baseline")) throw new Error("Use evidence-driven adaptation after work has started.");
    const contract = await ctx.db.query("learningContracts").withIndex("by_journeyId", q => q.eq("journeyId", args.journeyId)).first();
    validatePlan(args.curriculum, {...journey, contract: contract?.contract});
    const version = (previous?.version ?? 0) + 1;
    if (previous) await ctx.db.patch(previous._id, { status: "superseded" });
    await ctx.db.insert("curriculumVersions", {
      journeyId: args.journeyId,
      version,
      status: "published",
      curriculum: args.curriculum,
      createdAt: Date.now()
    });
    await ctx.db.patch(args.journeyId, { status: "active", updatedAt: Date.now() });
    return version;
  }
});

export const markLessonComplete = mutation({
  args: {
    journeyId: v.id("journeys"),
    lessonId: v.string(),
    response: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) throw new Error("Learning journey not found.");
    const latest = await ctx.db.query("curriculumVersions")
      .withIndex("by_journey_version", (q) => q.eq("journeyId", args.journeyId))
      .order("desc").first();
    if (!latest) throw new Error("No published curriculum exists yet.");
    const curriculum = latest.curriculum as { lessons?: Array<{ id: string }> };
    if (!curriculum.lessons?.some((lesson) => lesson.id === args.lessonId)) throw new Error("Lesson not found in current curriculum.");
    await ctx.runMutation(internal.learn.ensureContract, {journeyId: args.journeyId});
    if (journey.completedLessonIds.includes(args.lessonId)) { await refreshFinalOutcomes(ctx, args.journeyId); return; }
    const completed = journey.completedLessonIds.includes(args.lessonId)
      ? journey.completedLessonIds
      : [...journey.completedLessonIds, args.lessonId];
    await ctx.db.patch(args.journeyId, { completedLessonIds: completed, status: curriculum.lessons.every(l => completed.includes(l.id)) ? "completed" : "active", updatedAt: Date.now() });
    await refreshFinalOutcomes(ctx, args.journeyId);
    await ctx.db.insert("learningEvidence", {
      journeyId: args.journeyId,
      lessonId: args.lessonId,
      kind: "lesson_completed",
      response: args.response,
      result: "completed",
      createdAt: Date.now()
    });
  }
});

export const getJourneyProposal = query({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args) => await ctx.db.query("journeyProposals")
    .withIndex("by_source_status", (q) => q.eq("sourceJourneyId", args.journeyId).eq("status", "prepared"))
    .order("desc").first()
});

export const acceptJourneyProposal = mutation({
  args: { proposalId: v.id("journeyProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.status !== "prepared") throw new Error("This journey proposal is no longer available.");
    const now = Date.now();
    const source = await ctx.db.get(proposal.sourceJourneyId);
    const sourceContract = await ctx.db.query("learningContracts").withIndex("by_journeyId", q => q.eq("journeyId", proposal.sourceJourneyId)).first();
    const learner = {topic: proposal.topic, startingKnowledge: "some" as const, desiredDepth: source?.desiredDepth ?? "understand" as const, dailyMinutes: source?.dailyMinutes ?? 10, goal: proposal.mode === "continue" ? source?.goal : undefined};
    const contract = makeContract(learner, proposal.mode === "continue" ? sourceContract?.contract.questions.map(q => q.text) : undefined);
    try { validatePlan(proposal.plan, {...learner, contract}); } catch { throw new Error("This proposal does not meet the learning contract. Dismiss it and prepare a new journey."); }
    const journeyId = await ctx.db.insert("journeys", {
      ...learner,
      topic: proposal.topic,
      startingKnowledge: "some",
      desiredDepth: proposal.plan.learnerModel?.desiredDepth ?? "understand",
      dailyMinutes: proposal.plan.learnerModel?.dailyMinutes ?? 10,
      status: "active",
      completedLessonIds: [],
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert("learningContracts", {journeyId, contract, origin: "original", createdAt: now});
    await ctx.db.insert("curriculumVersions", { journeyId, version: 1, status: "published", curriculum: proposal.plan, createdAt: now });
    await ctx.db.patch(args.proposalId, { status: "accepted", updatedAt: now });
    return journeyId;
  }
});

export const rejectJourneyProposal = mutation({
  args: { proposalId: v.id("journeyProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal?.status === "prepared") await ctx.db.patch(args.proposalId, { status: "rejected", updatedAt: Date.now() });
  }
});

export const saveLessonResponse = mutation({
  args: { journeyId: v.id("journeys"), lessonId: v.string(), response: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("learningEvidence", { journeyId: args.journeyId, lessonId: args.lessonId, kind: "lesson_response", response: args.response, createdAt: Date.now() });
  }
});

export const getNextJourneyContext = internalQuery({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) return null;
    const evidence = await ctx.db.query("learningEvidence").withIndex("by_journey", (q) => q.eq("journeyId", args.journeyId)).order("desc").take(40);
    const latest = await ctx.db.query("curriculumVersions").withIndex("by_journey_version", (q) => q.eq("journeyId", args.journeyId)).order("desc").first();
    const contract = await ctx.db.query("learningContracts").withIndex("by_journeyId", q => q.eq("journeyId", args.journeyId)).first();
    const assessmentEvidence = await ctx.db.query("assessmentAttempts").withIndex("by_journeyId", q => q.eq("journeyId", args.journeyId)).order("desc").take(100);
    return { assessmentEvidence, contract: contract?.contract ?? null, topic: journey.topic, goal: journey.goal ?? null, desiredDepth: journey.desiredDepth, dailyMinutes: journey.dailyMinutes, completedLessonIds: journey.completedLessonIds, curriculum: latest?.curriculum ?? null, evidence: evidence.map((item) => ({ kind: item.kind, lessonId: item.lessonId, response: item.response ?? "", result: item.result ?? "" })) };
  }
});

export const getPreparedProposal = internalQuery({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args) => await ctx.db.query("journeyProposals").withIndex("by_source_status", (q) => q.eq("sourceJourneyId", args.journeyId).eq("status", "prepared")).order("desc").first()
});

export const saveJourneyProposal = internalMutation({
  args: { sourceJourneyId: v.id("journeys"), topic: v.string(), mode: v.union(v.literal("continue"), v.literal("explore"), v.literal("discover")), rationale: v.string(), plan: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("journeyProposals").withIndex("by_source_status", (q) => q.eq("sourceJourneyId", args.sourceJourneyId).eq("status", "prepared")).first();
    if (existing) return existing._id;
    return await ctx.db.insert("journeyProposals", { ...args, status: "prepared", createdAt: Date.now(), updatedAt: Date.now() });
  }
});

// Existing records are snapshotted explicitly, never assigned invented baseline evidence.
export const ensureContract = internalMutation({
  args: {journeyId: v.id("journeys")}, returns: v.id("learningContracts"),
  handler: async (ctx, {journeyId}) => {
    const existing = await ctx.db.query("learningContracts").withIndex("by_journeyId", q => q.eq("journeyId", journeyId)).first();
    if (existing) return existing._id;
    const journey = await ctx.db.get(journeyId);
    if (!journey) throw new Error("Journey not found.");
    const latest = await ctx.db.query("curriculumVersions").withIndex("by_journey_version", q => q.eq("journeyId", journeyId)).order("desc").first();
    const contract = makeContract(journey);
    const objectives = (latest?.curriculum as Curriculum | undefined)?.objectives;
    if (objectives?.length) contract.objectives = objectives.map(o => ({id: o.id, questionId: contract.questions[0].id, statement: o.statement}));
    return await ctx.db.insert("learningContracts", {journeyId, contract, origin: "legacy_snapshot", createdAt: Date.now()});
  },
});
async function loopContext(ctx: QueryCtx, journeyId: Id<"journeys">) {
  const journey = await ctx.db.get(journeyId);
  if (!journey) throw new Error("Journey not found.");
  const contract = await ctx.db.query("learningContracts").withIndex("by_journeyId", q => q.eq("journeyId", journeyId)).first();
  const version = await ctx.db.query("curriculumVersions").withIndex("by_journey_version", q => q.eq("journeyId", journeyId)).order("desc").first();
  const recent = await ctx.db.query("assessmentAttempts").withIndex("by_journeyId", q => q.eq("journeyId", journeyId)).order("desc").take(1000);
  const baselines = await ctx.db.query("assessmentAttempts").withIndex("by_journeyId_and_kind", q => q.eq("journeyId", journeyId).eq("kind", "baseline")).order("desc").take(20);
  const attempts = [...recent, ...baselines.filter(b => !recent.some(a => a._id === b._id))].sort((a, b) => a._creationTime - b._creationTime);
  const adaptations = await ctx.db.query("adaptationRecords").withIndex("by_journeyId", q => q.eq("journeyId", journeyId)).order("desc").take(30);
  return {journey, contract, version, attempts, adaptations};
}
export const getLoopContext = internalQuery({ args: {journeyId: v.id("journeys")}, handler: async (ctx, args) => loopContext(ctx, args.journeyId) });
export const getLearningProgress = query({
  args: {journeyId: v.id("journeys")},
  handler: async (ctx, {journeyId}) => {
    const data = await loopContext(ctx, journeyId);
    const curriculum = data.version?.curriculum as Curriculum | undefined;
    const contract = data.contract?.contract;
    const objectives = (contract?.objectives ?? curriculum?.objectives ?? []).map(o => {
      const status = objectiveOutcome(o.id, data.attempts);
      const lessons = curriculum?.lessons.filter(l => l.objectiveIds.includes(o.id)) ?? [];
      const hasAttempt = data.attempts.some(a => a.objectiveId === o.id && a.kind !== "baseline");
      const started = lessons.some(l => data.journey.completedLessonIds.includes(l.id));
      return {...o, ...status, state: hasAttempt ? status.state : started ? "awaiting_assessment" : lessons.some(l => data.journey.startedLessonIds?.includes(l.id)) ? "in_progress" : "not_started",
        question: contract?.questions.find(q => q.id === ("questionId" in o ? o.questionId : ""))?.text ?? data.journey.goal ?? data.journey.topic,
        lessons: lessons.map(l => ({id: l.id, title: l.title, activities: l.activities})), evidence: data.attempts.filter(a => a.objectiveId === o.id)};
    });
    return {contract: data.contract, objectives, adaptations: data.adaptations, attempts: data.attempts, final: data.journey.status === "completed", allGoalsAchieved: objectives.length > 0 && objectives.every(o => o.outcome === "achieved")};
  },
});
export const recordAttempt = internalMutation({
  args: {journeyId: v.id("journeys"), contractId: v.id("learningContracts"), curriculumVersionId: v.optional(v.id("curriculumVersions")),
    lessonId: v.string(), activityId: v.string(), assessmentId: v.string(), objectiveId: v.string(), kind: v.union(v.literal("baseline"), v.literal("assessment"), v.literal("remediation")),
    parentAttemptId: v.optional(v.id("assessmentAttempts")), prompt: v.string(), rubric: rubricValue, response: v.string(), evaluation: v.optional(evaluationValue), error: v.optional(v.string())},
  returns: v.id("assessmentAttempts"),
  handler: async (ctx, args) => {
    const contract = await ctx.db.get(args.contractId);
    if (contract?.journeyId !== args.journeyId || !contract.contract.objectives.some(o => o.id === args.objectiveId)) throw new Error("Invalid contract objective.");
    if (args.evaluation) validateEvaluation(args.evaluation, args.objectiveId, args.rubric, args.response);
    if (args.kind === "baseline") {
      const journey = await ctx.db.get(args.journeyId);
      const diagnostic = (journey?.calibrationQuestions as {id: string; objectiveId: string; prompt: string; rubric: {criterion: string; expectedEvidence: string}[]}[] | undefined)?.find(q => q.id === args.assessmentId);
      if (!diagnostic || diagnostic.objectiveId !== args.objectiveId || diagnostic.prompt !== args.prompt || JSON.stringify(diagnostic.rubric.map(r => [r.criterion, r.expectedEvidence])) !== JSON.stringify(args.rubric.map(r => [r.criterion, r.expectedEvidence]))) throw new Error("Invalid diagnostic reference.");
    } else {
      if (!args.curriculumVersionId) throw new Error("Assessment requires a curriculum version.");
      const version = await ctx.db.get(args.curriculumVersionId);
      if (version?.journeyId !== args.journeyId) throw new Error("Invalid curriculum reference.");
      const curriculum = version.curriculum as Curriculum;
      const lesson = curriculum.lessons.find(l => l.id === args.lessonId);
      const assessment = curriculum.assessments.find(a => a.id === args.assessmentId);
      if (!lesson || !assessment || !lesson.assessmentIds.includes(assessment.id) || !assessment.objectiveIds.includes(args.objectiveId)) throw new Error("Broken assessment reference.");
      const activity = lesson.activities.find(a => a.id === args.activityId && a.objectiveIds.includes(args.objectiveId));
      if (!activity && !(args.activityId === `${lesson.id}:legacy-activity` && lesson.activities.every(a => !a.id))) throw new Error("Broken activity reference.");
      let expectedPrompt = assessment.prompt;
      let expectedRubric = assessment.rubric;
      if (args.parentAttemptId) {
        const parent = await ctx.db.get(args.parentAttemptId);
        if (!parent || parent.journeyId !== args.journeyId || parent.objectiveId !== args.objectiveId || parent.lessonId !== args.lessonId || parent.assessmentId !== args.assessmentId || parent.curriculumVersionId !== args.curriculumVersionId || !parent.evaluation?.remediation) throw new Error("Invalid remediation reference.");
        expectedPrompt = parent.evaluation.remediation.prompt;
        expectedRubric = parent.rubric;
      }
      if ((args.kind === "remediation") !== !!args.parentAttemptId || args.prompt !== expectedPrompt || JSON.stringify(expectedRubric.map(r => [r.criterion, r.expectedEvidence])) !== JSON.stringify(args.rubric.map(r => [r.criterion, r.expectedEvidence]))) throw new Error("Assessment must use its persisted prompt and rubric.");
    }
    const id = await ctx.db.insert("assessmentAttempts", {...args, status: args.evaluation ? "evaluated" : "unavailable", createdAt: Date.now()});
    await refreshFinalOutcomes(ctx, args.journeyId);
    return id;
  },
});
export const commitAdaptation = internalMutation({
  args: {journeyId: v.id("journeys"), previousVersionId: v.id("curriculumVersions"), curriculum: v.any(), rationale: v.string(), evidenceIds: v.array(v.id("assessmentAttempts")), currentLessonId: v.string()},
  handler: async (ctx, args) => {
    const data = await loopContext(ctx, args.journeyId);
    if (!data.version || !data.contract) throw new Error("Missing learning contract or plan.");
    const record = {journeyId: args.journeyId, previousVersionId: args.previousVersionId, evidenceIds: args.evidenceIds, rationale: args.rationale, createdAt: Date.now()};
    try {
      if (data.version._id !== args.previousVersionId) throw new Error("Plan changed while adapting; retry.");
      const evidence = data.attempts.filter(a => data.attempts.filter(e => e.objectiveId === a.objectiveId && e.kind !== "baseline" && e.evaluation).at(-1)?._id === a._id && args.evidenceIds.includes(a._id) && a.kind !== "baseline" && a.evaluation && ["developing", "insufficient_evidence"].includes(a.evaluation.outcome));
      if (!evidence.length) throw new Error("Adaptation needs assessed gaps, not lesson completion.");
      const previous = data.version.curriculum as Curriculum;
      const index = previous.lessons.findIndex(l => l.id === args.currentLessonId);
      if (index < 0) throw new Error("Lesson not found.");
      const protectedIds = [...(data.journey.startedLessonIds ?? []), ...data.journey.completedLessonIds, ...previous.lessons.slice(0, index + 1).map(l => l.id), ...data.attempts.map(a => a.lessonId)];
      const result = safeAdaptation(previous, args.curriculum, {...data.journey, contract: data.contract.contract}, protectedIds);
      const objectiveIds = [...new Set(evidence.map(e => e.objectiveId))];
      if (result.diff.some(d => !d.before.objectiveIds.some(id => objectiveIds.includes(id)) && !d.after.objectiveIds.some(id => objectiveIds.includes(id)))) throw new Error("Adaptation changes work unrelated to the assessed gap.");
      let newVersionId: Id<"curriculumVersions"> | undefined;
      if (result.changed) {
        newVersionId = await ctx.db.insert("curriculumVersions", {journeyId: args.journeyId, version: data.version.version + 1, status: "published", curriculum: result.next, createdAt: Date.now()});
        await ctx.db.patch(data.version._id, {status: "superseded"});
      }
      await ctx.db.insert("adaptationRecords", {...record, ...(newVersionId ? {newVersionId} : {}), objectiveIds, status: result.changed ? "published" : "unchanged", diff: result.diff.map(d => ({lessonId: d.lessonId, before: JSON.stringify(d.before), after: JSON.stringify(d.after)}))});
      return {ok: true, changed: result.changed, message: result.changed ? `Adapted ${result.changed} future lessons: ${args.rationale}` : "No meaningful change; current version retained."};
    } catch (error) {
      const message = error instanceof Error ? error.message : "Adaptation rejected.";
      await ctx.db.insert("adaptationRecords", {...record, objectiveIds: [], status: "rejected", error: message, diff: []});
      return {ok: false, changed: 0, message: `Previous plan retained. ${message}`};
    }
  },
});

async function refreshFinalOutcomes(ctx: MutationCtx, journeyId: Id<"journeys">) {
  const data = await loopContext(ctx, journeyId);
  if (data.journey.status !== "completed" || !data.contract || !data.version) return;
  for (const objective of data.contract.contract.objectives) {
    const status = objectiveOutcome(objective.id, data.attempts);
    const fields = {journeyId, contractId: data.contract._id, curriculumVersionId: data.version._id, objectiveId: objective.id,
      baseline: status.baseline, outcome: status.outcome, gaps: status.gaps, nextAction: status.nextAction,
      evidenceIds: data.attempts.filter(a => a.objectiveId === objective.id).map(a => a._id), updatedAt: Date.now()};
    const previous = await ctx.db.query("objectiveOutcomes").withIndex("by_journeyId_and_objectiveId", q => q.eq("journeyId", journeyId).eq("objectiveId", objective.id)).first();
    if (previous) await ctx.db.patch(previous._id, fields);
    else await ctx.db.insert("objectiveOutcomes", fields);
  }
}
export const startLesson = mutation({
  args: {journeyId: v.id("journeys"), lessonId: v.string()}, returns: v.null(),
  handler: async (ctx, args) => {
    const data = await loopContext(ctx, args.journeyId);
    if (!(data.version?.curriculum as Curriculum | undefined)?.lessons.some(l => l.id === args.lessonId)) throw new Error("Lesson not found.");
    await ctx.runMutation(internal.learn.ensureContract, {journeyId: args.journeyId});
    const started = data.journey.startedLessonIds ?? [];
    if (!started.includes(args.lessonId)) await ctx.db.patch(args.journeyId, {startedLessonIds: [...started, args.lessonId]});
    return null;
  },
});

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const listJourneys = query({
  args: {},
  handler: async (ctx) => {
    const journeys = await ctx.db.query("journeys").withIndex("by_updated").order("desc").collect();
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
      .order("desc").collect();
    return { ...journey, curriculum: versions[0]?.curriculum ?? null, curriculumVersion: versions[0]?.version ?? null };
  }
});

export const createJourney = mutation({
  args: {
    topic: v.string(),
    startingKnowledge: v.union(v.literal("new"), v.literal("some"), v.literal("experienced"), v.literal("expert")),
    desiredDepth: v.union(v.literal("explore"), v.literal("understand"), v.literal("deep"), v.literal("master")),
    dailyMinutes: v.number(),
    goal: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const topic = args.topic.trim();
    if (!topic) throw new Error("Enter a topic to learn.");
    if (topic.length > 160) throw new Error("Keep the topic under 160 characters.");
    if (![5, 10, 15, 30].includes(args.dailyMinutes)) throw new Error("Choose a supported daily time budget.");
    const now = Date.now();
    return await ctx.db.insert("journeys", {
      ...args, topic, status: "calibrating", completedLessonIds: [], createdAt: now, updatedAt: now
    });
  }
});

export const getJourneyForGeneration = internalQuery({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args) => await ctx.db.get(args.journeyId)
});

export const saveCalibration = internalMutation({
  args: { journeyId: v.id("journeys"), questions: v.any() },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) throw new Error("Learning journey not found.");
    await ctx.db.patch(args.journeyId, {
      calibrationQuestions: args.questions,
      status: "calibrating",
      updatedAt: Date.now()
    });
  }
});

export const submitCalibration = mutation({
  args: { journeyId: v.id("journeys"), answers: v.any() },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) throw new Error("Learning journey not found.");
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
    const completed = journey.completedLessonIds.includes(args.lessonId)
      ? journey.completedLessonIds
      : [...journey.completedLessonIds, args.lessonId];
    await ctx.db.patch(args.journeyId, { completedLessonIds: completed, updatedAt: Date.now() });
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
    const journeyId = await ctx.db.insert("journeys", {
      topic: proposal.topic,
      startingKnowledge: "some",
      desiredDepth: proposal.plan.learnerModel?.desiredDepth ?? "understand",
      dailyMinutes: proposal.plan.learnerModel?.dailyMinutes ?? 10,
      status: "active",
      completedLessonIds: [],
      createdAt: now,
      updatedAt: now
    });
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

export const saveAssessment = mutation({
  args: { journeyId: v.id("journeys"), lessonId: v.string(), response: v.string(), result: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("learningEvidence", { journeyId: args.journeyId, lessonId: args.lessonId, kind: "assessment", response: args.response, result: args.result, createdAt: Date.now() });
  }
});

export const getNextJourneyContext = internalQuery({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) return null;
    const evidence = await ctx.db.query("learningEvidence").withIndex("by_journey", (q) => q.eq("journeyId", args.journeyId)).order("desc").take(40);
    const latest = await ctx.db.query("curriculumVersions").withIndex("by_journey_version", (q) => q.eq("journeyId", args.journeyId)).order("desc").first();
    return { topic: journey.topic, goal: journey.goal ?? null, desiredDepth: journey.desiredDepth, dailyMinutes: journey.dailyMinutes, completedLessonIds: journey.completedLessonIds, curriculum: latest?.curriculum ?? null, evidence: evidence.map((item) => ({ kind: item.kind, lessonId: item.lessonId, response: item.response ?? "", result: item.result ?? "" })) };
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

export const getAdaptationContext = internalQuery({
  args: { journeyId: v.id("journeys"), lessonId: v.string() },
  handler: async (ctx, args) => {
    const journey = await ctx.db.get(args.journeyId);
    if (!journey) return null;
    const latest = await ctx.db.query("curriculumVersions")
      .withIndex("by_journey_version", (q) => q.eq("journeyId", args.journeyId))
      .order("desc").first();
    if (!latest) return null;
    const curriculum = latest.curriculum as { lessons?: Array<any>; objectives?: Array<any>; [key: string]: any };
    const currentIndex = (curriculum.lessons ?? []).findIndex((lesson) => lesson.id === args.lessonId);
    if (currentIndex < 0) return null;
    const evidence = await ctx.db.query("learningEvidence")
      .withIndex("by_journey", (q) => q.eq("journeyId", args.journeyId))
      .order("desc")
      .take(100);
    return {
      topic: journey.topic,
      desiredDepth: journey.desiredDepth,
      startingKnowledge: journey.startingKnowledge,
      dailyMinutes: journey.dailyMinutes,
      goal: journey.goal ?? null,
      completedLessonIds: journey.completedLessonIds,
      curriculum,
      currentLessonId: args.lessonId,
      currentLessonIndex: currentIndex,
      evidence: evidence
        .filter((item) => item.lessonId === args.lessonId || journey.completedLessonIds.includes(item.lessonId))
        .map((item) => ({ lessonId: item.lessonId, kind: item.kind, response: item.response ?? "", result: item.result ?? "", createdAt: item.createdAt }))
        .slice(0, 30)
    };
  }
});

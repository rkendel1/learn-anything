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

export const saveLessonResponse = mutation({
  args: { journeyId: v.id("journeys"), lessonId: v.string(), response: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("learningEvidence", {
      journeyId: args.journeyId,
      lessonId: args.lessonId,
      kind: "lesson_response",
      response: args.response,
      createdAt: Date.now()
    });
  }
});

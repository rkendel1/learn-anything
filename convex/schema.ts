import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  journeys: defineTable({
    topic: v.string(),
    startingKnowledge: v.union(
      v.literal("new"),
      v.literal("some"),
      v.literal("experienced"),
      v.literal("expert")
    ),
    desiredDepth: v.union(
      v.literal("explore"),
      v.literal("understand"),
      v.literal("deep"),
      v.literal("master")
    ),
    dailyMinutes: v.number(),
    goal: v.optional(v.string()),
    status: v.union(
      v.literal("calibrating"),
      v.literal("planning"),
      v.literal("active"),
      v.literal("completed")
    ),
    calibrationQuestions: v.optional(v.any()),
    calibrationAnswers: v.optional(v.any()),
    completedLessonIds: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_updated", ["updatedAt"]),
  curriculumVersions: defineTable({
    journeyId: v.id("journeys"),
    version: v.number(),
    status: v.union(v.literal("published"), v.literal("superseded")),
    curriculum: v.any(),
    createdAt: v.number()
  }).index("by_journey_version", ["journeyId", "version"]),
  learningEvidence: defineTable({
    journeyId: v.id("journeys"),
    lessonId: v.string(),
    kind: v.string(),
    response: v.optional(v.string()),
    result: v.optional(v.string()),
    createdAt: v.number(),
    idempotencyKey: v.optional(v.string())
  }).index("by_journey", ["journeyId"]).index("by_idempotency", ["journeyId", "idempotencyKey"]),
  journeyProposals: defineTable({
    sourceJourneyId: v.id("journeys"),
    topic: v.string(),
    mode: v.union(v.literal("continue"), v.literal("explore"), v.literal("discover")),
    rationale: v.string(),
    plan: v.any(),
    status: v.union(v.literal("prepared"), v.literal("accepted"), v.literal("rejected")),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_source_status", ["sourceJourneyId", "status"])
});

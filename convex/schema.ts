import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { contractValue, evaluationValue, rubricValue } from "./learningValidators";
export default defineSchema({
  objectiveOutcomes: defineTable({journeyId: v.id("journeys"), contractId: v.id("learningContracts"), curriculumVersionId: v.id("curriculumVersions"), objectiveId: v.string(),
    baseline: v.union(v.literal("unknown"), v.literal("not_demonstrated"), v.literal("developing"), v.literal("demonstrated")),
    outcome: v.union(v.literal("achieved"), v.literal("partially achieved"), v.literal("not demonstrated"), v.literal("not assessed")),
    evidenceIds: v.array(v.id("assessmentAttempts")), gaps: v.array(v.string()), nextAction: v.string(), updatedAt: v.number(),
  }).index("by_journeyId_and_objectiveId", ["journeyId", "objectiveId"]),
  learningContracts: defineTable({ journeyId: v.id("journeys"), contract: contractValue, origin: v.union(v.literal("original"), v.literal("legacy_snapshot")), createdAt: v.number() }).index("by_journeyId", ["journeyId"]),
  assessmentAttempts: defineTable({
    journeyId: v.id("journeys"), contractId: v.id("learningContracts"), curriculumVersionId: v.optional(v.id("curriculumVersions")),
    lessonId: v.string(), activityId: v.string(), assessmentId: v.string(), objectiveId: v.string(),
    kind: v.union(v.literal("baseline"), v.literal("assessment"), v.literal("remediation")),
    parentAttemptId: v.optional(v.id("assessmentAttempts")), prompt: v.string(), rubric: rubricValue, response: v.string(),
    status: v.union(v.literal("unavailable"), v.literal("evaluated")), evaluation: v.optional(evaluationValue), error: v.optional(v.string()), createdAt: v.number(),
  }).index("by_journeyId", ["journeyId"]).index("by_journeyId_and_objectiveId", ["journeyId", "objectiveId"]).index("by_journeyId_and_kind", ["journeyId", "kind"]),
  adaptationRecords: defineTable({ journeyId: v.id("journeys"), previousVersionId: v.id("curriculumVersions"), newVersionId: v.optional(v.id("curriculumVersions")),
    evidenceIds: v.array(v.id("assessmentAttempts")), objectiveIds: v.array(v.string()), rationale: v.string(),
    status: v.union(v.literal("published"), v.literal("rejected"), v.literal("unchanged")), error: v.optional(v.string()),
    diff: v.array(v.object({lessonId: v.string(), before: v.string(), after: v.string()})), createdAt: v.number(),
  }).index("by_journeyId", ["journeyId"]),
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
    startedLessonIds: v.optional(v.array(v.string())),
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

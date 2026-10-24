import { v } from "convex/values";
export const contractValue = v.object({
  version: v.number(), topic: v.string(), startingKnowledge: v.union(v.literal("new"), v.literal("some"), v.literal("experienced"), v.literal("expert")),
  desiredDepth: v.union(v.literal("explore"), v.literal("understand"), v.literal("deep"), v.literal("master")), dailyMinutes: v.number(), goal: v.string(), schedule: v.array(v.number()),
  questions: v.array(v.object({id: v.string(), text: v.string(), capability: v.string()})),
  objectives: v.array(v.object({id: v.string(), questionId: v.string(), statement: v.string()})),
});
export const rubricValue = v.array(v.object({criterion: v.string(), expectedEvidence: v.string()}));
export const evaluationValue = v.object({
  objectiveId: v.string(), outcome: v.union(v.literal("insufficient_evidence"), v.literal("developing"), v.literal("demonstrated"), v.literal("mastered")),
  criteria: v.array(v.object({criterion: v.string(), met: v.boolean(), evidence: v.string(), explanation: v.string()})),
  explanation: v.string(), nextAction: v.string(), remediation: v.union(v.null(), v.object({instruction: v.string(), workedExample: v.string(), prompt: v.string()})),
});
export const diagnosticValue = v.array(v.object({ id: v.string(), objectiveId: v.string(), prompt: v.string(), concept: v.string(), expectedAnswer: v.string(), rubric: rubricValue }));

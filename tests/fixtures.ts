import type { Curriculum, LearnerInput } from "../convex/learningCore";
export const input: LearnerInput = { topic: "Fractions", startingKnowledge: "new", desiredDepth: "understand", dailyMinutes: 10 };
export function fixture(): Curriculum {
  return {
    schemaVersion: "learn-anything.curriculum/1", topic: input.topic, title: "A week of fractions",
    scope: { included: ["Fractions"], excluded: [], rationale: "Build from equal parts to addition." },
    learnerModel: { declaredStartingKnowledge: "new", desiredDepth: "understand", dailyMinutes: 10, calibrationStatus: "completed", assumptions: [] },
    objectives: ["parts", "addition"].map(id => ({ id, statement: `Explain ${id}`, assessmentMethod: "Worked example", prerequisiteObjectiveIds: [] })),
    lessons: Array.from({ length: 7 }, (_, i) => ({
      id: `day${i + 1}`, day: i + 1, title: "Equal parts", purpose: "Understand equal parts", lessonBody: "One half describes one of two equal parts of a whole.",
      objectiveIds: ["parts", "addition"], prerequisiteIds: i ? [`day${i}`] : [], estimatedMinutes: 10, teachingFormat: "worked_example",
      contentOutline: ["Equal parts"], activities: [{ id: `day${i + 1}-practice`, type: "practice", prompt: "Split a circle into two equal parts.", objectiveIds: ["parts", "addition"] }], assessmentIds: ["check"], sourceIds: [],
    })),
    assessments: [{ id: "check", objectiveIds: ["parts", "addition"], kind: "application", prompt: "Draw one half", rubric: [{ criterion: "Equal parts", expectedEvidence: "Two equal parts" }], passingCriteria: "Correct division" }],
    sources: [], totalEstimatedMinutes: 70, completionCriteria: ["Complete lessons"], limitations: ["Not independently verified"],
  };
}

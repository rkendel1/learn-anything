import { z } from "zod";

const text = z.string().trim().min(1);
const refs = z.array(text);
const lessonSchema = z.object({
  id: text, day: z.number().int().min(1).max(7), title: text, purpose: text,
  lessonBody: text, objectiveIds: refs.min(1), prerequisiteIds: refs,
  estimatedMinutes: z.number().int().positive(), teachingFormat: text,
  contentOutline: refs.min(1),
  activities: z.array(z.object({ id: text, type: text, prompt: text, objectiveIds: refs.min(1) })).min(1),
  assessmentIds: refs.min(1), sourceIds: z.array(z.string()).max(0),
});
export const curriculumSchema = z.object({
  schemaVersion: z.literal("learn-anything.curriculum/1"), topic: text, title: text,
  scope: z.object({ included: refs.min(1), excluded: refs, rationale: text }),
  learnerModel: z.object({
    declaredStartingKnowledge: z.enum(["new", "some", "experienced", "expert"]),
    desiredDepth: z.enum(["explore", "understand", "deep", "master"]),
    dailyMinutes: z.number().int().positive(), calibrationStatus: z.literal("completed"), assumptions: refs,
  }),
  objectives: z.array(z.object({ id: text, statement: text, assessmentMethod: text, prerequisiteObjectiveIds: refs })).min(1),
  lessons: z.array(lessonSchema).length(7),
  assessments: z.array(z.object({
    id: text, objectiveIds: refs.min(1), kind: text, prompt: text,
    rubric: z.array(z.object({ criterion: text, expectedEvidence: text })).min(1), passingCriteria: text,
  })).min(1),
  sources: z.array(z.string()).max(0), totalEstimatedMinutes: z.number().positive(),
  completionCriteria: refs.min(1), limitations: refs,
});
export type Curriculum = z.infer<typeof curriculumSchema>;
export type LearnerInput = {
  topic: string; startingKnowledge: "new" | "some" | "experienced" | "expert";
  desiredDepth: "explore" | "understand" | "deep" | "master";
  dailyMinutes: number; goal?: string; calibrationAnswers?: unknown; contract?: LearningContract;
};

export function validatePlan(value: unknown, input: LearnerInput): Curriculum {
  const plan = curriculumSchema.parse(value);
  const fail = () => { throw new Error("Generated curriculum has inconsistent references or learner constraints."); };
  if (plan.topic !== input.topic || plan.learnerModel.declaredStartingKnowledge !== input.startingKnowledge ||
      plan.learnerModel.desiredDepth !== input.desiredDepth || plan.learnerModel.dailyMinutes !== input.dailyMinutes) fail();
  const objectives = new Set(plan.objectives.map(o => o.id));
  const assessments = new Set(plan.assessments.map(a => a.id));
  if (objectives.size !== plan.objectives.length || assessments.size !== plan.assessments.length) fail();
  const hasObjectives = (ids: string[]) => ids.every(id => objectives.has(id));
  for (const objective of plan.objectives) {
    if (!hasObjectives(objective.prerequisiteObjectiveIds) || objective.prerequisiteObjectiveIds.includes(objective.id)) fail();
  }
  for (const assessment of plan.assessments) if (!hasObjectives(assessment.objectiveIds)) fail();
  const covered = new Set(plan.lessons.flatMap(l => l.objectiveIds));
  const assessed = new Set(plan.assessments.map(a => a.id).filter(id => plan.lessons.some(l => l.assessmentIds.includes(id))).flatMap(id => plan.assessments.find(a => a.id === id)!.objectiveIds));
  if (plan.objectives.some(o => !covered.has(o.id) || !assessed.has(o.id))) fail();
  if (input.contract && (plan.objectives.length !== input.contract.objectives.length || input.contract.objectives.some(o => !objectives.has(o.id) || plan.objectives.find(p => p.id === o.id)?.statement !== o.statement))) fail();
  if (input.contract && plan.assessments.some(a => a.objectiveIds.length !== 1)) fail();
  const activityIds = plan.lessons.flatMap(l => l.activities.map(a => a.id));
  if (new Set(activityIds).size !== activityIds.length) fail();
  const taught = new Set<string>();
  const previous = new Set<string>();
  for (const [i, lesson] of plan.lessons.entries()) {
    if (lesson.id !== `day${i + 1}` || lesson.day !== i + 1 || lesson.estimatedMinutes > input.dailyMinutes ||
        !lesson.prerequisiteIds.every(id => previous.has(id)) || !hasObjectives(lesson.objectiveIds) ||
        !lesson.assessmentIds.every(id => assessments.has(id)) ||
        !lesson.activities.every(a => hasObjectives(a.objectiveIds))) fail();
    for (const id of lesson.objectiveIds) {
      if (!plan.objectives.find(o => o.id === id)!.prerequisiteObjectiveIds.every(p => taught.has(p))) fail();
    }
    if (!lesson.activities.every(a => a.objectiveIds.every(id => lesson.objectiveIds.includes(id))) ||
        !lesson.assessmentIds.every(id => plan.assessments.find(a => a.id === id)!.objectiveIds.every(o => lesson.objectiveIds.includes(o)))) fail();
    if (lesson.objectiveIds.some(id => !lesson.activities.some(a => a.objectiveIds.includes(id)))) fail();
    // Allow one minute per activity and per assessment, plus reading time.
    if (lesson.lessonBody.split(/\s+/).length / 130 + lesson.activities.length + lesson.assessmentIds.length > lesson.estimatedMinutes) fail();
    lesson.objectiveIds.forEach(id => taught.add(id));
    previous.add(lesson.id);
  }
  if (plan.totalEstimatedMinutes !== plan.lessons.reduce((sum, lesson) => sum + lesson.estimatedMinutes, 0)) fail();
  return plan;
}


export type LearningContract = {
  version: number; topic: string; startingKnowledge: LearnerInput["startingKnowledge"];
  desiredDepth: LearnerInput["desiredDepth"]; dailyMinutes: number; goal: string;
  schedule: number[]; questions: { id: string; text: string; capability: string }[];
  objectives: { id: string; questionId: string; statement: string }[];
};
export function makeContract(input: LearnerInput, questions?: string[]): LearningContract {
  const originals = (questions?.length ? questions : [input.goal || `How can I explain and apply ${input.topic}?`]).map(q => q.trim());
  if (originals.some(q => !q || q.length > 1000) || originals.length > 4) throw new Error("Provide one to four questions, under 1000 characters each.");
  return { version: 1, topic: input.topic, startingKnowledge: input.startingKnowledge, desiredDepth: input.desiredDepth,
    dailyMinutes: input.dailyMinutes, goal: input.goal || `Explain and apply ${input.topic}`, schedule: [1,2,3,4,5,6,7],
    questions: originals.map((text, i) => ({ id: `question${i+1}`, text, capability: `Answer with reasoning and a concrete example: ${text}` })),
    objectives: originals.map((text, i) => ({ id: `objective${i+1}`, questionId: `question${i+1}`, statement: `Demonstrate an answer to “${text}” using correct concepts, reasoning, and a worked example.` })) };
}
export const evaluationSchema = z.object({
  objectiveId: text,
  outcome: z.enum(["insufficient_evidence", "developing", "demonstrated", "mastered"]),
  criteria: z.array(z.object({ criterion: text, met: z.boolean(), evidence: z.string(), explanation: text })).min(1),
  explanation: text, nextAction: text,
  remediation: z.object({ instruction: text, workedExample: text, prompt: text }).nullable(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export function validateEvaluation(raw: unknown, objectiveId: string, rubric: {criterion: string}[], response: string): Evaluation {
  const e = evaluationSchema.parse(raw);
  if (!response.trim() || e.objectiveId !== objectiveId || e.criteria.length !== rubric.length ||
      rubric.some((r, i) => e.criteria[i].criterion !== r.criterion) ||
      e.criteria.some(c => c.met && (!c.evidence.trim() || !response.includes(c.evidence))) ||
      (["demonstrated", "mastered"].includes(e.outcome) && e.criteria.some(c => !c.met)) ||
      (["developing", "insufficient_evidence"].includes(e.outcome) && !e.remediation)) throw new Error("Invalid assessment evidence; retry assessment.");
  return e;
}
export function safeAdaptation(previous: Curriculum, proposed: unknown, input: LearnerInput, protectedIds: string[]) {
  previous = validatePlan(previous, input);
  const next = validatePlan(proposed, input);
  if (JSON.stringify(previous.objectives) !== JSON.stringify(next.objectives) || JSON.stringify(previous.assessments) !== JSON.stringify(next.assessments)) throw new Error("Adaptation cannot rewrite objectives or assessment rubrics.");
  for (const id of protectedIds) if (JSON.stringify(previous.lessons.find(l => l.id === id)) !== JSON.stringify(next.lessons.find(l => l.id === id))) throw new Error("Completed or attempted work is immutable.");
  for (const [i, lesson] of next.lessons.entries()) {
    if (JSON.stringify(lesson.activities.map(a => ({id: a.id, objectiveIds: a.objectiveIds}))) !== JSON.stringify(previous.lessons[i].activities.map(a => ({id: a.id, objectiveIds: a.objectiveIds})))) throw new Error("Adaptation cannot break stable activity references.");
  }
  const diff = next.lessons.filter((l, i) => JSON.stringify(l) !== JSON.stringify(previous.lessons[i])).map(l => ({ lessonId: l.id, before: previous.lessons.find(p => p.id === l.id)!, after: l }));
  return { next, diff, changed: diff.length };
}
export type EvidenceSummary = { objectiveId: string; kind: "baseline" | "assessment" | "remediation"; evaluation?: Evaluation; status: "evaluated" | "unavailable"; prompt?: string; };
export function objectiveOutcome(objectiveId: string, attempts: EvidenceSummary[]) {
  const baseline = attempts.filter(a => a.objectiveId === objectiveId && a.kind === "baseline" && a.evaluation).at(-1)?.evaluation;
  const assessed = attempts.filter(a => a.objectiveId === objectiveId && a.kind !== "baseline" && a.status === "evaluated" && a.evaluation);
  const latest = assessed.at(-1)?.evaluation;
  // Mastery requires two independent successful assessments, never calibration alone.
  const lastGap = assessed.findLastIndex(a => !["demonstrated", "mastered"].includes(a.evaluation!.outcome));
  const successes = assessed.slice(lastGap + 1).filter(a => ["demonstrated", "mastered"].includes(a.evaluation!.outcome));
  const state = !latest ? "awaiting_assessment" : ["demonstrated", "mastered"].includes(latest.outcome) ? new Set(successes.map(a => a.prompt)).size >= 2 ? "mastered" : "demonstrated" : "needs_practice";
  return { baseline: !baseline ? "unknown" as const : baseline.outcome === "insufficient_evidence" ? "not_demonstrated" as const : baseline.outcome === "developing" ? "developing" as const : "demonstrated" as const,
    state, outcome: !latest ? "not assessed" as const : state === "demonstrated" || state === "mastered" ? "achieved" as const : latest.outcome === "developing" ? "partially achieved" as const : "not demonstrated" as const,
    gaps: latest?.criteria.filter(c => !c.met).map(c => `${c.criterion}: ${c.explanation}`) ?? ["Submit an objective-linked assessment."], nextAction: latest?.nextAction ?? "Answer an assessment question; completion alone is not evidence." };
}

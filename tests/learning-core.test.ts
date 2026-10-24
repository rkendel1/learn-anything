import {test} from "node:test";
import assert from "node:assert/strict";
import {makeContract, objectiveOutcome, safeAdaptation, validateEvaluation, validatePlan, type Evaluation} from "../convex/learningCore";
import {fixture, input} from "./fixtures";
const correct: Evaluation = {objectiveId: "parts", outcome: "demonstrated", criteria: [{criterion: "Equal parts", met: true, evidence: "equal", explanation: "Correct equality concept."}], explanation: "Correct", nextAction: "Practice transfer", remediation: null};
test("question and capability IDs remain stable across reload", () => {
  const c = makeContract(input, ["Why must halves be equal?"]);
  assert.equal(c.objectives[0].questionId, c.questions[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
});
for (const [name, change] of Object.entries<(p: ReturnType<typeof fixture>) => void>({
  "missing coverage": p => {p.lessons.forEach(l => {l.objectiveIds = ["parts"]; l.activities.forEach(a => {a.objectiveIds = ["parts"];});});},
  "missing assessment coverage": p => {p.assessments[0].objectiveIds = ["parts"];},
  "duplicate activity IDs": p => {p.lessons[1].activities[0].id = p.lessons[0].activities[0].id;},
  "objective prerequisite order": p => {p.objectives[0].prerequisiteObjectiveIds = ["addition"];},
  "hidden reading workload": p => {p.lessons[0].lessonBody = "word ".repeat(2000);},
})) test(`validation rejects ${name}`, () => {const p = fixture(); change(p); assert.throws(() => validatePlan(p, input));});
test("calibration alone never grants mastery or final achievement", () => {
  const outcome = objectiveOutcome("parts", [{objectiveId: "parts", kind: "baseline", status: "evaluated", evaluation: correct}]);
  assert.equal(outcome.baseline, "demonstrated"); assert.equal(outcome.outcome, "not assessed");
});
test("unavailable grading and no response never pass", () => {
  assert.throws(() => validateEvaluation(correct, "parts", [{criterion: "Equal parts"}], ""));
  assert.throws(() => validateEvaluation({...correct, criteria: [{...correct.criteria[0], met: false}]}, "parts", [{criterion: "Equal parts"}], "equal"));
  assert.throws(() => validateEvaluation({...correct, objectiveId: "unrelated"}, "parts", [{criterion: "Equal parts"}], "equal"));
  assert.equal(objectiveOutcome("parts", [{objectiveId: "parts", kind: "assessment", status: "unavailable"}]).outcome, "not assessed");
});
test("objective isolation and repeated answers do not establish mastery", () => {
  const attempt = {objectiveId: "parts", kind: "assessment" as const, status: "evaluated" as const, evaluation: correct, prompt: "Same prompt"};
  assert.equal(objectiveOutcome("addition", [attempt]).outcome, "not assessed");
  assert.equal(objectiveOutcome("parts", [attempt, attempt]).state, "demonstrated");
  assert.equal(objectiveOutcome("parts", [attempt, {...attempt, prompt: "Independent transfer"}]).state, "mastered");
});
test("no-op adaptation and completed work preservation", () => {
  const p = fixture(); assert.equal(safeAdaptation(p, structuredClone(p), input, ["day1"]).changed, 0);
  const changed = structuredClone(p); changed.lessons[0].lessonBody += " revised";
  assert.throws(() => safeAdaptation(p, changed, input, ["day1"]));
  changed.lessons[0] = p.lessons[0]; changed.lessons[1].purpose += " targeted explanation";
  assert.equal(safeAdaptation(p, changed, input, ["day1"]).changed, 1);
});

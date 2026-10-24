import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { createLearningContent, validatePlan, type Curriculum } from "../convex/curriculumAgent";

import { input, fixture } from "./fixtures";
test("accepts a complete, connected seven-day course", () => {
  assert.deepEqual(validatePlan(fixture(), input), fixture());
});
for (const [name, change] of Object.entries<(plan: Curriculum) => void>({
  "missing teaching content": p => { p.lessons[0].lessonBody = ""; },
  "too few days": p => { p.lessons.pop(); },
  "duplicate lesson ids": p => { p.lessons[1].id = "day1"; },
  "out-of-order days": p => { p.lessons[0].day = 2; },
  "unknown objectives": p => { p.lessons[0].objectiveIds = ["unknown"]; },
  "unknown activity objective": p => { p.lessons[0].activities[0].objectiveIds = ["unknown"]; },
  "unknown assessments": p => { p.lessons[0].assessmentIds = ["unknown"]; },
  "future prerequisite": p => { p.lessons[0].prerequisiteIds = ["day2"]; },
  "time overrun": p => { p.lessons[0].estimatedMinutes = 11; },
  "incorrect total": p => { p.totalEstimatedMinutes = 100; },
  "wrong learner depth": p => { p.learnerModel.desiredDepth = "master"; },
  "wrong topic": p => { p.topic = "Geometry"; },
  "duplicate objectives": p => { p.objectives[1].id = p.objectives[0].id; },
  "fabricated sources": p => { p.lessons[0].sourceIds = ["unverified"]; },
})) {
  test(`rejects ${name}`, () => {
    const plan = fixture(); change(plan);
    assert.throws(() => validatePlan(plan, input));
  });
}

function response(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
    warnings: [],
  };
}
test("plans once and writes all seven lessons without changing their structure", async () => {
  const planner = new MockLanguageModelV4({ doGenerate: response(fixture()) });
  const body = "A fraction describes equal parts of one whole. In 1/2, the bottom number tells you there are two equal parts and the top number tells you to take one. For example, split a pizza equally between two people: each receives one half. Unequal slices do not represent halves.";
  let written = 0;
  const writer = new MockLanguageModelV4({ doGenerate: async () => response({ lessonBody: body, activities: fixture().lessons[written++].activities }) });
  const plan = await createLearningContent(input, { planner, writer });
  assert.equal(planner.doGenerateCalls.length, 1);
  assert.equal(writer.doGenerateCalls.length, 7);
  assert.ok(plan.lessons.every(l => l.lessonBody === body));
  assert.deepEqual(plan.lessons.map(l => l.id), fixture().lessons.map(l => l.id));
});
test("rejects invalid planning before spending on content writing", async () => {
  const invalid = fixture(); invalid.lessons[0].estimatedMinutes = 11;
  const planner = new MockLanguageModelV4({ doGenerate: response(invalid) });
  const writer = new MockLanguageModelV4();
  await assert.rejects(createLearningContent(input, { planner, writer }));
  assert.equal(writer.doGenerateCalls.length, 0);
});
test("does not return a partially written course when content generation fails", async () => {
  const planner = new MockLanguageModelV4({ doGenerate: response(fixture()) });
  const writer = new MockLanguageModelV4({ doGenerate: response({ lessonBody: "Only an outline", activities: [] }) });
  await assert.rejects(createLearningContent(input, { planner, writer }));
});

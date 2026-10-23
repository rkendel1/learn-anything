"use node";

import { v } from "convex/values";
import { generateText, gateway } from "ai";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

type Knowledge = "new" | "some" | "experienced" | "expert";
type Depth = "explore" | "understand" | "deep" | "master";

type AdaptationContext = {
  topic: string;
  desiredDepth: string;
  startingKnowledge: string;
  dailyMinutes: number;
  goal: string | null;
  completedLessonIds: string[];
  curriculum: { lessons?: Array<any>; [key: string]: any };
  currentLessonId: string;
  currentLessonIndex: number;
  evidence: Array<{ lessonId: string; kind: string; response: string; result: string; createdAt: number }>;
} | null;

async function askModel<T>(system: string, user: unknown, fallback: () => T): Promise<T> {
  try {
    const result = await generateText({
      model: gateway(process.env.AI_MODEL || "openai/o4-mini"),
      system,
      prompt: JSON.stringify(user),
      temperature: 0.2,
      maxOutputTokens: 8000,
    });
    const text = result.text.trim().replace(/^```json\\s*|\\s*```$/g, "");
    return JSON.parse(text) as T;
  } catch (error) {
    console.error("[v0] Model generation failed; using safe fallback.", error);
    return fallback();
  }
}

function fallbackQuestions(topic: string) {
  return {
    questions: [
      { id: "q1", prompt: `What do you already understand about ${topic}? A sentence or two is enough.`, concept: "prior_knowledge", expectedAnswer: "A relevant description of prior knowledge." },
      { id: "q2", prompt: `What is one question about ${topic} that you would most like to be able to answer?`, concept: "learning_goal", expectedAnswer: "A question connected to the topic." }
    ]
  };
}

export const generateCalibration = action({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args): Promise<Array<{ id: string; prompt: string; concept: string; expectedAnswer: string }>> => {
    const journey: Doc<"journeys"> | null = await ctx.runQuery(internal.learn.getJourneyForGeneration, { journeyId: args.journeyId });
    if (!journey) throw new Error("Learning journey not found.");
    const result: { questions: Array<{ id: string; prompt: string; concept: string; expectedAnswer: string }> } = await askModel<{ questions: Array<{ id: string; prompt: string; concept: string; expectedAnswer: string }> }>(
      "Create exactly 2 friendly, low-pressure calibration questions for a personalized learning journey. Do not quiz the user on everything. Return JSON: { questions: [{ id, prompt, concept, expectedAnswer }] }. No markdown.",
      {
        topic: journey.topic,
        startingKnowledge: journey.startingKnowledge,
        desiredDepth: journey.desiredDepth,
        dailyMinutes: journey.dailyMinutes,
        goal: journey.goal ?? null
      },
      () => fallbackQuestions(journey.topic)
    );
    const questions = Array.isArray(result.questions) && result.questions.length >= 1
      ? result.questions.slice(0, 4).map((q, i) => ({
          id: String(q.id || `q${i + 1}`),
          prompt: String(q.prompt || `What do you already know about ${journey.topic}?`),
          concept: String(q.concept || "prior_knowledge"),
          expectedAnswer: String(q.expectedAnswer || "A relevant response.")
        }))
      : fallbackQuestions(journey.topic).questions;
    await ctx.runMutation(internal.learn.saveCalibration, { journeyId: args.journeyId, questions });
    return questions;
  }
});

function fallbackCurriculum(input: {
  topic: string; startingKnowledge: Knowledge; desiredDepth: Depth; dailyMinutes: number; goal?: string;
  calibrationAnswers?: unknown;
}) {
  const depthText: Record<Depth, string> = {
    explore: "Build an engaging overview and connect memorable ideas.",
    understand: "Build a coherent mental model and practice explaining core ideas.",
    deep: "Examine mechanisms, nuance, limitations, and competing explanations.",
    master: "Build toward demonstrable competence through cumulative practice; one week is a first phase, not a guarantee of mastery."
  };
  const topic = input.topic;
  const titles = [
    `Map the landscape of ${topic}`,
    `Learn the essential building blocks`,
    `Connect the core ideas`,
    `See how ${topic} works in practice`,
    `Explore a challenging case`,
    `Apply what you've learned`,
    `Review and show what you understand`
  ];
  const purposes = [
    "Establish the big picture and identify the most important questions.",
    "Build the vocabulary and concepts needed for the rest of the journey.",
    "Explain how the main ideas fit together.",
    "Work through a concrete example or application.",
    "Investigate a common misconception, limitation, or more difficult example.",
    "Use the ideas in a small exercise or practical task.",
    "Retrieve the key ideas and check progress against the week's objectives."
  ];
  const objectives = [
    { id: "obj1", statement: `Describe the landscape and central questions of ${topic}.`, assessmentMethod: "Explain the topic in your own words.", prerequisiteObjectiveIds: [] },
    { id: "obj2", statement: `Explain the core concepts that underpin ${topic}.`, assessmentMethod: "Answer a concept check and explain one example.", prerequisiteObjectiveIds: ["obj1"] },
    { id: "obj3", statement: `Connect important ideas within ${topic}.`, assessmentMethod: "Describe a relationship between two concepts.", prerequisiteObjectiveIds: ["obj2"] },
    { id: "obj4", statement: `Apply at least one idea from ${topic} to a concrete example.`, assessmentMethod: "Complete an application exercise.", prerequisiteObjectiveIds: ["obj2"] }
  ];
  const lessons = titles.map((title, i) => ({
    id: `day${i + 1}`,
    day: i + 1,
    title,
    purpose: purposes[i],
    lessonBody: `Today, we will build one useful piece of understanding about ${topic}. Start by thinking about what you already know. ${depthText[input.desiredDepth]} Work through the example slowly, then explain the main idea in your own words. If something feels unfamiliar, treat it as a question to investigate rather than a mistake.`,
    objectiveIds: [i === 0 ? "obj1" : i < 3 ? "obj2" : i < 6 ? "obj4" : "obj3"],
    prerequisiteIds: i === 0 ? [] : [`day${i}`],
    estimatedMinutes: input.dailyMinutes,
    teachingFormat: (i === 0 ? "explanation" : i === 3 ? "worked_example" : i === 5 ? "project" : i === 6 ? "review" : "guided_practice"),
    contentOutline: [
      `A focused explanation of ${topic}, pitched for a learner who reports ${input.startingKnowledge} prior knowledge.`,
      depthText[input.desiredDepth],
      "A concrete example, analogy, or worked case.",
      "A short takeaway and a prompt to check understanding."
    ],
    activities: [
      { type: i === 6 ? "recall" : "practice", prompt: i === 6 ? `Without looking back, explain the most important things you learned about ${topic}.` : `Apply today's idea to an example involving ${topic}.`, objectiveIds: [i === 0 ? "obj1" : "obj2"] }
    ],
    assessmentIds: [`assess${i + 1}`],
    sourceIds: []
  }));
  const assessments = lessons.map((lesson, i) => ({
    id: `assess${i + 1}`,
    objectiveIds: lesson.objectiveIds,
    kind: i === 5 ? "application" : i === 6 ? "explanation" : "recall",
    prompt: i === 6 ? `Explain the most important idea you learned about ${topic}, and give an example.` : `What is one important idea from "${lesson.title}"? Explain it briefly.`,
    rubric: [{ criterion: "Relevance", expectedEvidence: "The response addresses the stated concept." }, { criterion: "Understanding", expectedEvidence: "The response is coherent and includes a relevant explanation or example." }],
    passingCriteria: "Provides a relevant answer and demonstrates at least one correct concept; use feedback rather than treating this as a formal mastery claim."
  }));
  return {
    schemaVersion: "learn-anything.curriculum/1",
    topic,
    title: `A week of ${topic}`,
    scope: {
      included: [`Core ideas in ${topic}`, "Examples and connections", "A short practice and review"],
      excluded: input.desiredDepth === "master" ? ["Claiming full mastery in one week"] : ["Exhaustive coverage of the entire field"],
      rationale: `A starter plan aligned to ${input.desiredDepth} depth and ${input.dailyMinutes} minutes per day. ${depthText[input.desiredDepth]}`
    },
    learnerModel: {
      declaredStartingKnowledge: input.startingKnowledge,
      desiredDepth: input.desiredDepth,
      dailyMinutes: input.dailyMinutes,
      calibrationStatus: "completed",
      assumptions: ["Starter curriculum uses a broad topic interpretation.", "Source retrieval is not configured in this scaffold; verify factual claims before relying on them."]
    },
    objectives,
    lessons,
    assessments,
    sources: [],
    totalEstimatedMinutes: input.dailyMinutes * 7,
    completionCriteria: ["Complete the daily learning activities", "Attempt the end-of-week review", "Identify what to revisit or learn next"],
    limitations: ["This starter curriculum is a planning scaffold, not verified subject-matter research.", "No sources were retrieved in fallback mode.", ...(input.desiredDepth === "master" ? ["One week cannot guarantee mastery of a broad subject."] : [])]
  };
}

function validateCurriculum(c: any, journey: any) {
  const errors: string[] = [];
  if (c?.schemaVersion !== "learn-anything.curriculum/1") errors.push("Invalid schema version");
  if (!Array.isArray(c?.lessons) || c.lessons.length !== 7) errors.push("Curriculum must contain seven lessons");
  if (!Array.isArray(c?.objectives) || c.objectives.length < 2) errors.push("At least two objectives are required");
  if (!Array.isArray(c?.assessments) || c.assessments.length < 1) errors.push("At least one assessment is required");
  if (c?.learnerModel?.desiredDepth !== journey.desiredDepth) errors.push("Depth does not match journey");
  if (c?.learnerModel?.dailyMinutes !== journey.dailyMinutes) errors.push("Time budget does not match journey");
  if (Array.isArray(c?.lessons)) {
    for (const lesson of c.lessons) {
      if (!lesson.id || !lesson.title || !lesson.purpose || !Number.isFinite(lesson.estimatedMinutes)) errors.push("A lesson is missing required fields");
      if (lesson.estimatedMinutes > journey.dailyMinutes) errors.push(`Lesson ${lesson.id} exceeds the daily time budget`);
    }
  }
  return errors;
}

export const generateCurriculum = action({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args): Promise<{ ok: boolean; usedFallback: boolean; curriculum: Record<string, unknown> }> => {
    const journey: Doc<"journeys"> | null = await ctx.runQuery(internal.learn.getJourneyForGeneration, { journeyId: args.journeyId });
    if (!journey) throw new Error("Learning journey not found.");
    if (!journey.calibrationAnswers) throw new Error("Complete the calibration questions first.");
    const input: Parameters<typeof fallbackCurriculum>[0] = {
      topic: journey.topic,
      startingKnowledge: journey.startingKnowledge as Knowledge,
      desiredDepth: journey.desiredDepth as Depth,
      dailyMinutes: journey.dailyMinutes,
      goal: journey.goal ?? undefined,
      calibrationAnswers: journey.calibrationAnswers,
    };
    const generated = await askModel<any>(
      `You are the curriculum planner for Learn Anything. Return only valid JSON conforming to this contract: schemaVersion "learn-anything.curriculum/1"; topic, title; scope {included:string[], excluded:string[], rationale:string}; learnerModel {declaredStartingKnowledge, desiredDepth, dailyMinutes, calibrationStatus:"completed", assumptions:string[]}; objectives [{id,statement,assessmentMethod,prerequisiteObjectiveIds:string[]}]; exactly 7 lessons [{id:"day1"..."day7",day,title,purpose,lessonBody:string (a concise, learner-facing explanation, not meta-instructions),objectiveIds:string[],prerequisiteIds:string[],estimatedMinutes,teachingFormat,contentOutline:string[],activities:[{type,prompt,objectiveIds:string[]}],assessmentIds:string[],sourceIds:string[]}]; assessments [{id,objectiveIds:string[],kind,prompt,rubric:[{criterion,expectedEvidence}],passingCriteria}]; sources:[]; totalEstimatedMinutes; completionCriteria:string[]; limitations:string[]. No invented sources or URLs. Each lesson's estimatedMinutes must be <= dailyMinutes. Objectives must be observable and assessments aligned. Distinguish the user's self-reported knowledge from demonstrated knowledge. ${journey.desiredDepth === "master" ? "Do not promise mastery in a week; define this as an initial phase toward measurable competencies." : ""} Return JSON only.`,
      input,
      () => fallbackCurriculum(input)
    );
    // Normalize the user-specific fields regardless of model output.
    const curriculum = {
      ...generated,
      schemaVersion: "learn-anything.curriculum/1",
      topic: journey.topic,
      learnerModel: {
        ...(generated.learnerModel ?? {}),
        declaredStartingKnowledge: journey.startingKnowledge,
        desiredDepth: journey.desiredDepth,
        dailyMinutes: journey.dailyMinutes,
        calibrationStatus: "completed"
      },
      lessons: (Array.isArray(generated.lessons) ? generated.lessons : fallbackCurriculum(input).lessons).map((lesson: any, i: number) => ({ ...lesson, lessonBody: typeof lesson.lessonBody === "string" && lesson.lessonBody.trim() ? lesson.lessonBody : (fallbackCurriculum(input).lessons[i]?.lessonBody ?? `Today we will explore ${journey.topic} through a focused example.`) })),
      sources: Array.isArray(generated.sources) ? generated.sources : [],
      totalEstimatedMinutes: journey.dailyMinutes * 7
    };
    const errors = validateCurriculum(curriculum, journey);
    const finalCurriculum: Record<string, unknown> = errors.length ? {
      ...fallbackCurriculum(input),
      limitations: [...fallbackCurriculum(input).limitations, `Model-generated draft failed validation and was replaced with a starter plan: ${errors.join("; ")}`]
    } : curriculum;
    await ctx.runMutation(internal.learn.publishCurriculum, { journeyId: args.journeyId, curriculum: finalCurriculum });
    return { ok: true, usedFallback: errors.length > 0 || !process.env.OPENAI_API_KEY, curriculum: finalCurriculum };
  }
});

export const recommendTopics = action({
  args: { recentTopics: v.array(v.string()), mode: v.union(v.literal("recommend"), v.literal("surprise")) },
  handler: async (_ctx, args) => {
    const fallback = () => ({
      topics: (args.mode === "surprise"
        ? [
            { topic: "Why maps distort the world", reason: "A surprising look at how every flat map makes choices.", depth: "understand" },
            { topic: "The hidden mathematics of music", reason: "Explore the patterns behind rhythm, harmony, and melody.", depth: "explore" },
            { topic: "How cities shape human behavior", reason: "Discover how streets and public spaces influence daily life.", depth: "understand" }
          ]
        : [
            { topic: "The history of timekeeping", reason: "A related journey connecting science, culture, and daily life.", depth: "understand" },
            { topic: "How memory works", reason: "Learn how people encode, retrieve, and forget information.", depth: "explore" },
            { topic: "Thinking in systems", reason: "A practical way to understand complex problems.", depth: "deep" }
          ]).filter((x) => !args.recentTopics.some((t) => t.toLowerCase() === x.topic.toLowerCase()))
    });
    return await askModel<{ topics: Array<{ topic: string; reason: string; depth: string }> }>(
      "Recommend three engaging learning topics. Return JSON {topics:[{topic,reason,depth}]}. Each topic must be distinct and not duplicate recent topics. For surprise mode, maximize productive novelty and avoid generic popular topics.",
      args,
      fallback
    );
  }
});

export const evaluateAnswer = action({
  args: { journeyId: v.id("journeys"), lessonId: v.string(), response: v.string() },
  handler: async (ctx, args): Promise<{ result: string; feedback: string; objective: string }> => {
    const context: AdaptationContext = await ctx.runQuery(internal.learn.getAdaptationContext, { journeyId: args.journeyId, lessonId: args.lessonId });
    if (!context) throw new Error("Couldn't find the lesson.");
    const lesson = context.curriculum.lessons?.[context.currentLessonIndex] ?? {};
    const fallback = { result: args.response.trim().length > 20 ? "developing" : "needs_practice", objective: String(lesson.objectiveIds?.[0] ?? "core understanding"), feedback: args.response.trim().length > 20 ? "You made a meaningful attempt. Revisit the key idea, then add one concrete example to make your explanation stronger." : "Start with one clear sentence about the main idea, then add an example or reason." };
    const evaluation = await askModel<typeof fallback>("Evaluate a learner answer objectively. Return JSON {result:'clear_understanding'|'developing'|'needs_practice', objective:string, feedback:string}. Tie feedback to the lesson objective. Do not claim mastery.", { lesson, response: args.response }, () => fallback);
    await ctx.runMutation(api.learn.saveAssessment, { journeyId: args.journeyId, lessonId: args.lessonId, response: args.response, result: JSON.stringify(evaluation) });
    return evaluation;
  }
});

export const adaptUpcomingLessons = action({
  args: {
    journeyId: v.id("journeys"),
    lessonId: v.string()
  },
  handler: async (ctx, args): Promise<{ ok: boolean; changed: number; message: string; usedFallback?: boolean }> => {
    const context: AdaptationContext = await ctx.runQuery(internal.learn.getAdaptationContext, args);
    if (!context) throw new Error("Couldn't find the learning journey or lesson.");

    const lessons = Array.isArray(context.curriculum.lessons) ? context.curriculum.lessons : [];
    const futureLessons = lessons.slice(context.currentLessonIndex + 1)
      .filter((lesson: any) => !context.completedLessonIds.includes(lesson.id));
    if (!futureLessons.length) {
      return { ok: true, changed: 0, message: "There are no upcoming lessons left to adapt." };
    }

    const adapted = await askModel<Array<any>>(
      `You adapt upcoming lessons based on learner evidence. Return JSON { lessons: [...] } using the same lesson schema (id, day, title, purpose, lessonBody, objectiveIds, prerequisiteIds, estimatedMinutes, teachingFormat, contentOutline, activities, assessmentIds, sourceIds). Only change future lessons; preserve ids and day numbers. Reframe difficulty and examples based on the evidence.`,
      { journey: { topic: context.topic, desiredDepth: context.desiredDepth, startingKnowledge: context.startingKnowledge, dailyMinutes: context.dailyMinutes }, futureLessons, evidence: context.evidence },
      () => futureLessons
    );

    const changed = adapted.length;
    const updatedCurriculum = {
      ...context.curriculum,
      lessons: [
        ...lessons.slice(0, context.currentLessonIndex + 1),
        ...adapted
      ]
    };

    await ctx.runMutation(internal.learn.publishCurriculum, {
      journeyId: args.journeyId,
      curriculum: updatedCurriculum
    });

    return { ok: true, usedFallback: !process.env.OPENAI_API_KEY, changed, message: `Adapted ${changed} upcoming lesson(s).` };
  }
});

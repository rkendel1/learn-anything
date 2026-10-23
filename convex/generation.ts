"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { generateJson } from "./model";
import { createLearningContent } from "./curriculumAgent";
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

async function askModel<T>(system: string, user: unknown, fallback: () => T, operation: "routine" | "reasoning" = "routine"): Promise<{ value: T; usedFallback: boolean }> {
  return generateJson({ system, input: user, fallback, operation });
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
    const result = (await askModel<{ questions: Array<{ id: string; prompt: string; concept: string; expectedAnswer: string }> }>(
      "Create exactly 2 friendly, low-pressure calibration questions for a personalized learning journey. Do not quiz the user on everything. Return JSON: { questions: [{ id, prompt, concept, expectedAnswer }] }. No markdown.",
      {
        topic: journey.topic,
        startingKnowledge: journey.startingKnowledge,
        desiredDepth: journey.desiredDepth,
        dailyMinutes: journey.dailyMinutes,
        goal: journey.goal ?? null
      },
      () => fallbackQuestions(journey.topic)
    )).value;
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

export const generateCurriculum = action({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args): Promise<{ ok: boolean; usedFallback: boolean; curriculum: Record<string, unknown> }> => {
    const journey: Doc<"journeys"> | null = await ctx.runQuery(internal.learn.getJourneyForGeneration, { journeyId: args.journeyId });
    if (!journey) throw new Error("Learning journey not found.");
    if (!journey.calibrationAnswers) throw new Error("Complete the calibration questions first.");
    if (journey.completedLessonIds.length) throw new Error("Cannot regenerate a journey after lessons have been completed.");
    const input: Parameters<typeof fallbackCurriculum>[0] = {
      topic: journey.topic,
      startingKnowledge: journey.startingKnowledge as Knowledge,
      desiredDepth: journey.desiredDepth as Depth,
      dailyMinutes: journey.dailyMinutes,
      goal: journey.goal ?? undefined,
      calibrationAnswers: journey.calibrationAnswers,
    };
    let usedFallback = false;
    let finalCurriculum: Record<string, unknown>;
    try {
      finalCurriculum = await createLearningContent(input);
    } catch {
      usedFallback = true;
      const starter = fallbackCurriculum(input);
      finalCurriculum = {
        ...starter,
        limitations: ["AI content generation was unavailable or failed validation. This is a starter outline, not a generated course. Retry generation when the backend model is configured.", ...starter.limitations],
      };
    }
    await ctx.runMutation(internal.learn.publishCurriculum, { journeyId: args.journeyId, curriculum: finalCurriculum });
    return { ok: true, usedFallback, curriculum: finalCurriculum };
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
    return (await askModel<{ topics: Array<{ topic: string; reason: string; depth: string }> }>(
      "Recommend three engaging learning topics. Return JSON {topics:[{topic,reason,depth}]}. Each topic must be distinct and not duplicate recent topics. For surprise mode, maximize productive novelty and avoid generic popular topics.",
      args,
      fallback
    )).value;
  }
});

export const prepareNextJourney = action({
  args: { journeyId: v.id("journeys") },
  handler: async (ctx, args): Promise<{ proposalId: string; topic: string; mode: string; rationale: string }> => {
    const context = await ctx.runQuery(internal.learn.getNextJourneyContext, { journeyId: args.journeyId });
    if (!context) throw new Error("Finish setting up this journey before preparing the next one.");
    const existing = await ctx.runQuery(internal.learn.getPreparedProposal, { journeyId: args.journeyId });
    if (existing) return { proposalId: String(existing._id), topic: existing.topic, mode: existing.mode, rationale: existing.rationale };
    const fallback = { mode: "continue", topic: `The next step in ${context.topic}`, rationale: `You have started building a foundation in ${context.topic}; this continuation will deepen the ideas that still need practice.` } as const;
    const suggestion = (await askModel<typeof fallback>(
      "Suggest one next learning journey. Return JSON {mode:'continue'|'explore'|'discover',topic:string,rationale:string}. Ground it in the learner evidence, be concise, and do not claim mastery.", context,
      () => fallback, "reasoning"
    )).value;
    const mode = ["continue", "explore", "discover"].includes(suggestion.mode) ? suggestion.mode as "continue" | "explore" | "discover" : fallback.mode;
    const topic = String(suggestion.topic || fallback.topic).slice(0, 160);
    const rationale = String(suggestion.rationale || fallback.rationale).slice(0, 500);
    const input = { topic, startingKnowledge: "some" as Knowledge, desiredDepth: context.desiredDepth as Depth, dailyMinutes: context.dailyMinutes, goal: context.goal ?? undefined };
    // A continuation uses the same validated planning and content-writing pipeline.
    const plan = await createLearningContent(input);
    const proposalId = await ctx.runMutation(internal.learn.saveJourneyProposal, { sourceJourneyId: args.journeyId, topic, mode, rationale, plan });
    return { proposalId: String(proposalId), topic, mode, rationale };
  }
});

export const evaluateAnswer = action({
  args: { journeyId: v.id("journeys"), lessonId: v.string(), response: v.string() },
  handler: async (ctx, args): Promise<{ result: string; feedback: string; objective: string }> => {
    const context: AdaptationContext = await ctx.runQuery(internal.learn.getAdaptationContext, { journeyId: args.journeyId, lessonId: args.lessonId });
    if (!context) throw new Error("Couldn't find the lesson.");
    const lesson = context.curriculum.lessons?.[context.currentLessonIndex] ?? {};
    const fallback = { result: args.response.trim().length > 20 ? "developing" : "needs_practice", objective: String(lesson.objectiveIds?.[0] ?? "core understanding"), feedback: args.response.trim().length > 20 ? "You made a meaningful attempt. Revisit the key idea, then add one concrete example to make your explanation stronger." : "Start with one clear sentence about the main idea, then add an example or reason." };
    const evaluationResult = await askModel<typeof fallback>("Evaluate a learner answer objectively. Return JSON {result:'clear_understanding'|'developing'|'needs_practice', objective:string, feedback:string}. Tie feedback to the lesson objective. Do not claim mastery.", { lesson, response: args.response }, () => fallback);
    const evaluation = evaluationResult.value;
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

    const adaptedResult = await askModel<{ lessons: Array<any> }>(
      `You adapt upcoming lessons based on learner evidence. Return JSON { lessons: [...] } using the same lesson schema (id, day, title, purpose, lessonBody, objectiveIds, prerequisiteIds, estimatedMinutes, teachingFormat, contentOutline, activities, assessmentIds, sourceIds). Only change future lessons; preserve ids and day numbers. Reframe difficulty and examples based on the evidence.`,
      { journey: { topic: context.topic, desiredDepth: context.desiredDepth, startingKnowledge: context.startingKnowledge, dailyMinutes: context.dailyMinutes }, futureLessons, evidence: context.evidence },
      () => ({ lessons: futureLessons })
    );
    const adapted = Array.isArray(adaptedResult.value?.lessons) ? adaptedResult.value.lessons : futureLessons;
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

    return { ok: true, usedFallback: adaptedResult.usedFallback, changed, message: `Adapted ${changed} upcoming lesson(s).` };
  }
});

"use client";

import { FormEvent, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { ArrowRight, BookOpen, Check, Compass, Lightbulb, Sparkles, Clock3, RotateCcw } from "lucide-react";

type Knowledge = "new" | "some" | "experienced" | "expert";
type Depth = "explore" | "understand" | "deep" | "master";
type Question = { id: string; prompt: string; concept: string; expectedAnswer?: string };
type Lesson = {
  id: string; day: number; title: string; purpose: string; estimatedMinutes: number;
  lessonBody?: string; contentOutline: string[]; activities: { type: string; prompt: string }[];
};
type Journey = {
  _id: Id<"journeys">; topic: string; startingKnowledge: Knowledge; desiredDepth: Depth;
  dailyMinutes: number; goal?: string; status: string; calibrationQuestions?: Question[];
  calibrationAnswers?: Record<string, string>; completedLessonIds: string[];
  curriculum?: { title: string; scope: { rationale: string }; objectives: { id: string; statement: string }[]; lessons: Lesson[]; limitations?: string[]; totalEstimatedMinutes: number };
};

const knowledgeOptions: { value: Knowledge; label: string; desc: string }[] = [
  { value: "new", label: "I'm new to this", desc: "Start with the basics" },
  { value: "some", label: "I know a little", desc: "Build on what I know" },
  { value: "experienced", label: "I'm experienced", desc: "Skip routine introductions" },
  { value: "expert", label: "I know this well", desc: "Start with advanced ideas" }
];
const depthOptions: { value: Depth; label: string; desc: string }[] = [
  { value: "explore", label: "Explore", desc: "Get the big picture" },
  { value: "understand", label: "Understand", desc: "Build knowledge I can use" },
  { value: "deep", label: "Go deep", desc: "Explore nuance and mechanisms" },
  { value: "master", label: "Master it", desc: "Practice toward real competence" }
];
const surpriseTopics = ["The hidden mathematics of music", "How cities shape human behavior", "Why maps distort the world"];

export default function HomePage() {
  const journeys = useQuery(api.learn.listJourneys, {}) as Journey[] | undefined;
  const createJourney = useMutation(api.learn.createJourney);
  const submitCalibration = useMutation(api.learn.submitCalibration);
  const markLessonComplete = useMutation(api.learn.markLessonComplete);
  const generateCalibration = useAction(api.generation.generateCalibration);
  const generateCurriculum = useAction(api.generation.generateCurriculum);
  const recommendTopics = useAction(api.generation.recommendTopics);

  const [topic, setTopic] = useState("");
  const [knowledge, setKnowledge] = useState<Knowledge>("new");
  const [depth, setDepth] = useState<Depth>("understand");
  const [minutes, setMinutes] = useState(10);
  const [goal, setGoal] = useState("");
  const [step, setStep] = useState<"home" | "setup" | "calibration">("home");
  const [activeJourneyId, setActiveJourneyId] = useState<Id<"journeys"> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [calibrationQuestions, setCalibrationQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recommendations, setRecommendations] = useState<Array<{ topic: string; reason: string; depth?: string }>>([]);
  const [expandedLesson, setExpandedLesson] = useState<string | null>(null);
  const [reflection, setReflection] = useState("");

  const activeJourney = useMemo(() => {
    if (!journeys) return null;
    return (activeJourneyId ? journeys.find((j) => j._id === activeJourneyId) : null) ?? journeys.find((j) => j.status === "active") ?? journeys[0] ?? null;
  }, [journeys, activeJourneyId]);

  async function startJourney(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const id = await createJourney({ topic: topic.trim(), startingKnowledge: knowledge, desiredDepth: depth, dailyMinutes: minutes, ...(goal.trim() ? { goal: goal.trim() } : {}) });
      setActiveJourneyId(id);
      const questions = await generateCalibration({ journeyId: id }) as Question[];
      setCalibrationQuestions(questions);
      setAnswers(Object.fromEntries(questions.map((q) => [q.id, ""])));
      setStep("calibration");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start this learning journey.");
    } finally { setBusy(false); }
  }

  async function finishCalibration(e: FormEvent) {
    e.preventDefault();
    if (!activeJourneyId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await submitCalibration({ journeyId: activeJourneyId, answers });
      await generateCurriculum({ journeyId: activeJourneyId });
      setStep("home");
      setTopic("");
      setGoal("");
      setNotice("Your learning week is ready. Let's begin.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't prepare your curriculum.");
    } finally { setBusy(false); }
  }

  async function pickRecommendation(mode: "recommend" | "surprise") {
    setBusy(true); setError(""); setNotice("");
    try {
      const recentTopics = (journeys ?? []).map((j) => j.topic);
      const result = await recommendTopics({ recentTopics, mode });
      setRecommendations(result.topics ?? []);
      setNotice(mode === "surprise" ? "A few unexpected rabbit holes to explore." : "Picked for your curiosity.");
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't find topics right now."); }
    finally { setBusy(false); }
  }

  function beginRecommendedTopic(value: string) {
    setTopic(value); setStep("setup"); setRecommendations([]); setNotice("");
  }

  async function completeLesson(journey: Journey, lesson: Lesson) {
    setBusy(true); setError("");
    try {
      await markLessonComplete({ journeyId: journey._id, lessonId: lesson.id, ...(reflection.trim() ? { response: reflection.trim() } : {}) });
      setReflection("");
      setExpandedLesson(null);
      setNotice(`Day ${lesson.day} completed. Nice work.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save progress."); }
    finally { setBusy(false); }
  }

  const isLoading = journeys === undefined;
  const current = activeJourney;
  const curriculum = current?.curriculum;
  const completed = current?.completedLessonIds?.length ?? 0;
  const questions = calibrationQuestions.length ? calibrationQuestions : (current?.calibrationQuestions ?? []);

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Learn Anything home">
          <span className="brand-mark"><BookOpen size={19} /></span>
          <span>learn anything</span>
        </a>
        <span className="topbar-note">A little wiser every week.</span>
      </header>

      {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

      {step === "setup" && (
        <section className="setup-page">
          <button className="back-link" onClick={() => setStep("home")}>← Back to your learning space</button>
          <div className="section-kicker"><Sparkles size={15} /> START A NEW JOURNEY</div>
          <h1>What would you like<br />to learn?</h1>
          <p className="lead">We'll shape a week around what you know, how far you want to go, and the time you have.</p>
          <form onSubmit={startJourney} className="setup-form">
            <label className="field-label" htmlFor="topic">Your topic</label>
            <input id="topic" className="topic-input" autoFocus maxLength={160} required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Anything at all — from jazz to quantum physics" />
            <label className="field-label">Where are you starting?</label>
            <div className="option-grid knowledge-grid">
              {knowledgeOptions.map((option) => <button type="button" key={option.value} className={`option-card ${knowledge === option.value ? "selected" : ""}`} onClick={() => setKnowledge(option.value)}>
                <span className="option-check">{knowledge === option.value && <Check size={13} />}</span><strong>{option.label}</strong><small>{option.desc}</small>
              </button>)}
            </div>
            <label className="field-label">How deeply do you want to go?</label>
            <div className="option-grid depth-grid">
              {depthOptions.map((option) => <button type="button" key={option.value} className={`option-card ${depth === option.value ? "selected" : ""}`} onClick={() => setDepth(option.value)}>
                <span className="option-check">{depth === option.value && <Check size={13} />}</span><strong>{option.label}</strong><small>{option.desc}</small>
              </button>)}
            </div>
            <div className="time-goal-row">
              <div className="time-control">
                <label className="field-label">Daily time</label>
                <div className="time-options">{[5, 10, 15, 30].map((n) => <button type="button" key={n} className={`time-pill ${minutes === n ? "selected" : ""}`} onClick={() => setMinutes(n)}>{n} min</button>)}</div>
              </div>
              <div className="goal-control">
                <label className="field-label" htmlFor="goal">Anything specific you want to achieve? <span className="optional">Optional</span></label>
                <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. explain it to a friend" />
              </div>
            </div>
            <button className="primary-button wide" type="submit" disabled={busy || !topic.trim()}>{busy ? "Preparing your starting questions…" : "Find my starting point"} <ArrowRight size={17} /></button>
            <p className="form-footnote">First, two quick questions. Then we'll build your week.</p>
          </form>
        </section>
      )}

      {step === "calibration" && (
        <section className="setup-page calibration-page">
          <button className="back-link" onClick={() => setStep("setup")}>← Change topic settings</button>
          <div className="section-kicker"><Compass size={15} /> FIND YOUR STARTING POINT</div>
          <h1>Let's make this<br />week yours.</h1>
          <p className="lead">No test, no grades. Your answers help us meet you where you are.</p>
          <form className="setup-form" onSubmit={finishCalibration}>
            {questions.map((q, i) => <div className="calibration-question" key={q.id}>
              <label className="field-label" htmlFor={q.id}>0{i + 1} / {q.concept.replaceAll("_", " ")}</label>
              <p className="question-prompt">{q.prompt}</p>
              <textarea id={q.id} rows={3} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((old) => ({ ...old, [q.id]: e.target.value }))} placeholder="Write a little, or just a few words…" />
            </div>)}
            <button className="primary-button wide" type="submit" disabled={busy}>{busy ? "Building your learning week…" : "Build my learning week"} <ArrowRight size={17} /></button>
            <button className="text-button wide" type="button" disabled={busy} onClick={() => { setAnswers(Object.fromEntries(questions.map((q) => [q.id, ""]))); }}>Clear answers</button>
          </form>
        </section>
      )}

      {step === "home" && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <div className="section-kicker"><Sparkles size={15} /> YOUR PERSONAL LEARNING SPACE</div>
              <h1>Stay curious.<br /><em>Learn anything.</em></h1>
              <p>One small learning journey at a time. Thoughtfully prepared for you, at your level and your pace.</p>
              <button className="primary-button" onClick={() => { setStep("setup"); setTopic(""); }}><span>Choose a topic</span><ArrowRight size={17} /></button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="sun-disc"></div><div className="orbit orbit-one"></div><div className="orbit orbit-two"></div>
              <div className="orbit-dot dot-one"></div><div className="orbit-dot dot-two"></div><div className="orbit-dot dot-three"></div>
              <div className="art-book"><BookOpen size={53} strokeWidth={1.1} /></div>
              <span className="art-caption">a world of wonder</span>
            </div>
          </section>

          {current && curriculum && (
            <section className="current-week">
              <div className="section-heading">
                <div><div className="section-kicker">THIS WEEK · YOUR LEARNING JOURNEY</div><h2>{curriculum.title}</h2></div>
                <span className="progress-label">{completed} of {curriculum.lessons.length} days</span>
              </div>
              <p className="week-rationale">{curriculum.scope?.rationale}</p>
              <div className="progress-track"><span style={{ width: `${Math.min(100, completed / Math.max(1, curriculum.lessons.length) * 100)}%` }} /></div>
              <div className="lesson-list">
                {curriculum.lessons.map((lesson) => {
                  const done = current.completedLessonIds.includes(lesson.id);
                  const open = expandedLesson === lesson.id;
                  return <article key={lesson.id} className={`lesson-row ${done ? "done" : ""} ${open ? "expanded" : ""}`}>
                    <button className="lesson-main" onClick={() => setExpandedLesson(open ? null : lesson.id)}>
                      <span className="day-marker">{done ? <Check size={16} /> : String(lesson.day).padStart(2, "0")}</span>
                      <span className="lesson-title-wrap"><strong>{lesson.title}</strong><small>{lesson.purpose}</small></span>
                      <span className="lesson-time"><Clock3 size={13} /> {lesson.estimatedMinutes}m</span>
                    </button>
                    {open && <div className="lesson-detail">
                      <h4>Today's learning</h4>
                      {lesson.lessonBody && <p className="lesson-body">{lesson.lessonBody}</p>}
                      <ul>{lesson.contentOutline?.map((line, i) => <li key={i}>{line}</li>)}</ul>
                      {lesson.activities?.[0] && <div className="activity-box"><span className="activity-label">TRY IT</span><p>{lesson.activities[0].prompt}</p><textarea rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="Your thoughts, answer, or example…" /></div>}
                      {!done ? <button className="primary-button" disabled={busy} onClick={() => completeLesson(current, lesson)}>{busy ? "Saving…" : "Mark day complete"} <Check size={16} /></button> : <div className="completed-note"><Check size={15} /> Day completed. Keep going!</div>}
                    </div>}
                  </article>;
                })}
              </div>
              {curriculum.limitations?.length ? <details className="limitations"><summary>About this learning plan</summary><ul>{curriculum.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></details> : null}
            </section>
          )}

          {!current && !isLoading && <section className="empty-state">
            <div className="empty-icon"><BookOpen size={26} /></div><h2>Your next great discovery starts here.</h2><p>Choose a subject you love, follow a recommendation, or let curiosity surprise you.</p>
            <button className="primary-button" onClick={() => setStep("setup")}>Start your first week <ArrowRight size={17} /></button>
          </section>}
          {isLoading && <div className="loading-card">Opening your learning space…</div>}

          <section className="discovery-section">
            <div className="section-heading"><div><div className="section-kicker">FOLLOW YOUR CURIOSITY</div><h2>Where to next?</h2></div><span className="small-muted">A new possibility every week</span></div>
            <div className="discovery-cards">
              <button className="discovery-card" onClick={() => { setStep("setup"); setTopic(""); }}>
                <span className="discovery-icon choice-icon"><BookOpen size={20} /></span><strong>Your choice</strong><p>There's something you've always wanted to understand.</p><span className="card-link">Choose a topic <ArrowRight size={14} /></span>
              </button>
              <button className="discovery-card" disabled={busy} onClick={() => pickRecommendation("recommend")}>
                <span className="discovery-icon recommend-icon"><Lightbulb size={20} /></span><strong>Picked for you</strong><p>Ideas inspired by your interests and learning history.</p><span className="card-link">Find recommendations <ArrowRight size={14} /></span>
              </button>
              <button className="discovery-card" disabled={busy} onClick={() => pickRecommendation("surprise")}>
                <span className="discovery-icon surprise-icon"><Sparkles size={20} /></span><strong>Surprise me</strong><p>Step outside your usual interests. Find a new rabbit hole.</p><span className="card-link">Take a chance <ArrowRight size={14} /></span>
              </button>
            </div>
            {recommendations.length > 0 && <div className="recommendation-list">
              {recommendations.map((rec) => <button key={rec.topic} className="recommendation-item" onClick={() => beginRecommendedTopic(rec.topic)}>
                <span><strong>{rec.topic}</strong><small>{rec.reason}</small></span><ArrowRight size={17} />
              </button>)}
            </div>}
          </section>

          {journeys && journeys.length > 1 && <section className="history-section">
            <div className="section-heading"><div><div className="section-kicker">YOUR LEARNING TRAIL</div><h2>Curiosity, continued.</h2></div></div>
            <div className="history-list">{journeys.map((journey) => <button key={journey._id} className="history-item" onClick={() => setActiveJourneyId(journey._id)}>
              <span className="history-dot"></span><span><strong>{journey.topic}</strong><small>{journey.desiredDepth} · {journey.dailyMinutes} min/day</small></span><span className="history-status">{journey.status === "active" ? "In progress" : journey.status}</span>
            </button>)}</div>
          </section>}
        </>
      )}

      <footer className="footer"><span>learn anything</span><span>Made for the joy of knowing more.</span></footer>
    </main>
  );
}

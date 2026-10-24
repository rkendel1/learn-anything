"use client";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Curriculum } from "../convex/learningCore";

export function LearningProgress({journeyId}: {journeyId: Id<"journeys">}) {
  const progress = useQuery(api.learn.getLearningProgress, {journeyId});
  if (!progress) return <p role="status">Loading objective evidence…</p>;
  return <section className="activity-box">
    <h3>{progress.final ? "Final outcomes against your original goals" : "Your learning contract and evidence"}</h3>
    <p>{progress.contract?.contract.goal ?? "Legacy journey: original goals retained; baseline unknown until assessed."}</p>
    {progress.contract?.origin === "legacy_snapshot" && <p>Legacy snapshot: no historical mastery evidence has been invented.</p>}
    {progress.final && <p>{progress.allGoalsAchieved ? "All objectives demonstrated by recorded assessments." : "Scheduled work complete. Unresolved goals remain available for practice below."}</p>}
    {progress.objectives.map(o => <details key={o.id} open={progress.final}>
      <summary>{o.question} — {o.outcome} ({o.state.replaceAll("_", " ")})</summary>
      <p>{o.statement}</p><p>Baseline: {o.baseline}. Setup alone never establishes mastery.</p>
      <p>Taught in: {o.lessons.map(l => l.title).join(", ") || "Not yet planned"}</p>
      <p>{o.gaps.join(" · ")}</p><p>Next: {o.nextAction}</p>
      {o.evidence.map(a => <details key={a._id}><summary>{a.kind} · {a.status} · {a.evaluation?.outcome ?? "not assessed"}</summary>
        <p>Question: {a.prompt}</p><p>Your response: {a.response || "No response"}</p>
        <p>{a.evaluation?.explanation ?? a.error}</p>
        {a.evaluation?.criteria.map((c, i) => <p key={i}>{c.met ? "✓" : "Needs practice:"} {c.criterion} — {c.explanation} {c.evidence && <q>{c.evidence}</q>}</p>)}
        <small>Contract {progress.contract?.contract.version} · Curriculum {a.curriculumVersionId ?? "diagnostic"} · Objective {a.objectiveId} · Activity {a.activityId}</small>
      </details>)}
    </details>)}
    {progress.adaptations.map(a => <p key={a._id}>Adaptation {a.status}: {a.error ?? a.rationale} ({a.diff.length} lessons changed)</p>)}
  </section>;
}

export function LessonAssessment({journeyId, lessonId, assessments}: {journeyId: Id<"journeys">; lessonId: string; assessments: Curriculum["assessments"]}) {
  const progress = useQuery(api.learn.getLearningProgress, {journeyId});
  const evaluate = useAction(api.generation.evaluateAnswer);
  const [selection, setSelection] = useState("");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const options = assessments.flatMap(a => a.objectiveIds.map(id => ({key: `${a.id}:${id}`, assessmentId: a.id, objectiveId: id, prompt: a.prompt, rubric: a.rubric, parentAttemptId: undefined as Id<"assessmentAttempts"> | undefined})));
  const attempts = progress?.attempts.filter(a => a.lessonId === lessonId) ?? [];
  // Each failed assessment supplies its own persisted, new practice prompt.
  for (const a of attempts) if (a.evaluation?.remediation) options.push({key: a._id, assessmentId: a.assessmentId, objectiveId: a.objectiveId, prompt: a.evaluation.remediation.prompt, rubric: a.rubric, parentAttemptId: a._id});
  const selected = options.find(o => o.key === selection) ?? options[0];
  const parent = attempts.find(a => a._id === selected?.parentAttemptId);
  return <div className="activity-box">
    <h4>Check understanding — separate from completing the day</h4>
    {!selected ? <p>No objective assessment available. Regenerate before starting new work, or continue with a follow-on journey.</p> : <>
      <label>Assessment or targeted practice <select value={selected.key} disabled={busy} onChange={e => {setSelection(e.target.value); setResponse(""); setNotice("");}}>
        {options.map(o => <option key={o.key} value={o.key}>{o.parentAttemptId ? "Targeted practice" : "Assessment"} · {o.objectiveId} · {o.assessmentId}</option>)}
      </select></label>
      {parent?.evaluation?.remediation && <><p>{parent.evaluation.remediation.instruction}</p><p>Worked example: {parent.evaluation.remediation.workedExample}</p></>}
      <p>{selected.prompt}</p>
      <details><summary>What this checks</summary>{selected.rubric.map((r, i) => <p key={i}>{r.criterion}</p>)}</details>
      <textarea aria-label="Assessment answer" rows={4} value={response} onChange={e => setResponse(e.target.value)} placeholder="Explain your reasoning. Partial knowledge is welcome." />
      <button className="secondary-button" disabled={busy || !response.trim()} onClick={async () => {
        setBusy(true); setNotice("");
        try {
          const result = await evaluate({journeyId, lessonId, response, assessmentId: selected.assessmentId, objectiveId: selected.objectiveId, ...(selected.parentAttemptId ? {parentAttemptId: selected.parentAttemptId} : {})});
          setNotice(`${result.result}: ${result.feedback}`);
          if (result.result !== "unavailable") setResponse("");
        } catch (error) {setNotice(error instanceof Error ? error.message : "Assessment failed; retry.");}
        finally {setBusy(false);}
      }}>{busy ? "Evaluating…" : "Submit answer / retry assessment"}</button>
      <p role="status">{notice}</p>
    </>}
    {attempts.map(a => <details key={a._id} open={a.status === "unavailable" || !!a.evaluation?.remediation}>
      <summary>{a.kind} · {a.objectiveId} · {a.evaluation?.outcome ?? "Assessment unavailable — retry"}</summary>
      <p>Your answer: {a.response}</p><p>{a.evaluation?.explanation ?? a.error}</p>
      {a.evaluation?.criteria.filter(c => !c.met).map((c, i) => <p key={i}>Gap: {c.criterion} — {c.explanation}</p>)}
      {a.evaluation?.remediation && <><p>{a.evaluation.remediation.instruction}</p><p>Example: {a.evaluation.remediation.workedExample}</p><button className="text-button" onClick={() => {setSelection(a._id); setResponse("");}}>Try new targeted practice</button></>}
    </details>)}
  </div>;
}

import {
  courseReferenceSchema,
  type CourseReference,
  type LearningCourse,
  type LearningPathState,
  type CourseUnit,
  type CourseTeachingContext,
  type CourseEvidence,
} from "@call-nina/contracts";

export function resolveCourseReference(course: LearningCourse | null, value: CourseReference) {
  const reference = courseReferenceSchema.parse(value);
  const unit = course?.units.find((u) => u.id === reference.unitId);
  if (!course || course.version !== reference.version || !unit)
    throw new Error("OD_COURSE_REFERENCE_STALE");
  const activity = unit.activities.find((a) => a.id === reference.activityKey);
  if (!activity || (reference.mode === "review" && activity.delivery === "explanation"))
    throw new Error("OD_COURSE_REFERENCE_INVALID");
  return { reference, unit, activity };
}
export function sameCourseActivity(a: CourseReference, b: CourseReference) {
  return (
    a.version === b.version &&
    a.unitId === b.unitId &&
    a.activityKey === b.activityKey &&
    a.mode === b.mode &&
    a.retrieval === b.retrieval
  );
}
export function courseActivityStatus(state: LearningPathState, reference: CourseReference) {
  const mark = state.marks.find((m) => sameCourseActivity(m.reference, reference));
  if (mark) return mark.status;
  const mission = state.missions.find(
    (m) => m.version === reference.version && m.unitId === reference.unitId && m.mode === "course",
  );
  const activities = state.activities.filter(
    (a) =>
      sameCourseActivity(a.reference, reference) &&
      (!mission || reference.mode === "review" || a.missionId === mission.id),
  );
  if (activities.some((a) => a.completed)) return "completed" as const;
  return activities.length ? ("started" as const) : ("not-started" as const);
}
export function nextCourseActivity(
  course: LearningCourse,
  state: LearningPathState,
): CourseReference | null {
  if (
    state.current?.version === course.version &&
    state.current.mode === "course" &&
    !["completed", "skipped"].includes(courseActivityStatus(state, state.current))
  )
    return state.current;
  const units = course.units.filter(
    (u) => u.stage === state.selectedStage && u.kind !== "launchpad",
  );
  const start = Math.max(
    0,
    units.findIndex((u) => u.id === state.current?.unitId),
  );
  for (const unit of [...units.slice(start), ...units.slice(0, start)])
    for (const activity of unit.activities) {
      const reference: CourseReference = {
        version: course.version,
        unitId: unit.id,
        activityKey: activity.id,
        mode: "course",
      };
      if (!["completed", "skipped"].includes(courseActivityStatus(state, reference)))
        return reference;
    }
  return null;
}

const day = 86_400_000;
const intervals = [1, 3, 7, 14, 30];
export function courseOutcomeProgress(
  course: LearningCourse,
  state: LearningPathState,
  unit: CourseUnit,
  now = Date.now(),
) {
  return unit.objectives.map((objective) => {
    const events = state.activities
      .filter((a) => a.reference.version === course.version && a.reference.unitId === unit.id)
      .flatMap((a) =>
        a.evidence
          .filter((e) => e.objectiveId === objective.id)
          .map((e) => ({ ...e, variantId: a.variantId, activityId: a.activityId })),
      )
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const skills = objective.skills.map((skill) => {
      const attempts = new Map<string, (typeof events)[number]>();
      const rank = { "not-yet": 0, supported: 1, independent: 2, transfer: 3, "not-evaluated": -1 };
      for (const event of events.filter(
        (e) => e.skill === skill && e.outcome !== "not-evaluated",
      )) {
        const key = `${event.activityId}:${event.occurredAt}`;
        const previous = attempts.get(key);
        if (!previous) attempts.set(key, { ...event });
        else {
          if (rank[event.outcome] < rank[previous.outcome]) previous.outcome = event.outcome;
          previous.support = [...new Set([...previous.support, ...event.support])];
          if (event.uncertainty !== "none") previous.uncertainty = event.uncertainty;
        }
      }
      const evaluated = [...attempts.values()];
      const successes = evaluated.filter(
        (e) =>
          ["independent", "transfer"].includes(e.outcome) &&
          e.uncertainty === "none" &&
          !e.support.some((s) =>
            ["hint", "model-answer", "translation", "transcript", "repeat-attempt"].includes(s),
          ),
      );
      const latestDifficulty = evaluated.findLastIndex(
        (e) => !["independent", "transfer"].includes(e.outcome) || e.uncertainty !== "none",
      );
      const currentSuccesses = evaluated
        .slice(latestDifficulty + 1)
        .filter((e) => successes.includes(e));
      const established = currentSuccesses.some((first) =>
        currentSuccesses.some(
          (later) =>
            later.variantId !== first.variantId &&
            Date.parse(later.occurredAt) - Date.parse(first.occurredAt) >= day,
        ),
      );
      const latest = evaluated.at(-1);
      // Count distinct days, not repeated answers in a generated set, for spacing.
      const successfulDays = new Set(currentSuccesses.map((e) => e.occurredAt.slice(0, 10))).size;
      const struggling = !!latest && ["not-yet", "supported"].includes(latest.outcome);
      const interval = struggling
        ? 1
        : (intervals[Math.min(Math.max(0, successfulDays - 1), intervals.length - 1)] ?? 30);
      const dueAt = latest
        ? new Date(Date.parse(latest.occurredAt) + interval * day).toISOString()
        : null;
      return {
        skill,
        established,
        latest: latest ?? null,
        dueAt,
        due: !!dueAt && Date.parse(dueAt) <= now,
        struggling,
      };
    });
    return { objective, skills, established: skills.every((s) => s.established), events };
  });
}
export function courseUnitEvidenceComplete(
  course: LearningCourse,
  state: LearningPathState,
  unit: CourseUnit,
) {
  return (
    courseOutcomeProgress(course, state, unit)
      .filter((o) => o.objective.critical)
      .every((o) => o.established) &&
    unit.activities
      .filter((a) => a.purpose === "capstone")
      .every((a) =>
        state.activities.some(
          (result) =>
            result.completed &&
            result.reference.version === course.version &&
            result.reference.unitId === unit.id &&
            result.reference.activityKey === a.id,
        ),
      )
  );
}
export function dueCourseReviews(
  course: LearningCourse,
  state: LearningPathState,
  now = Date.now(),
): { reference: CourseReference; objectiveId: string; dueAt: string; struggling: boolean }[] {
  const outcomeReviews = course.units.flatMap((unit) =>
    courseOutcomeProgress(course, state, unit, now).flatMap((progress) =>
      progress.skills
        .filter((s) => s.due)
        .flatMap((s) => {
          const activity =
            unit.activities.find(
              (a) =>
                a.purpose === "capstone" &&
                a.delivery === s.skill &&
                a.objectiveIds.includes(progress.objective.id),
            ) ??
            unit.activities.find(
              (a) => a.delivery === s.skill && a.objectiveIds.includes(progress.objective.id),
            );
          return activity
            ? [
                {
                  reference: {
                    version: course.version,
                    unitId: unit.id,
                    activityKey: activity.id,
                    mode: "review" as const,
                  },
                  objectiveId: progress.objective.id,
                  dueAt: s.dueAt ?? new Date(now).toISOString(),
                  struggling: s.struggling,
                },
              ]
            : [];
        }),
    ),
  );
  const languageReviews = course.units.flatMap((unit) =>
    courseLanguageProgress(course, state, unit, now).flatMap((p) =>
      p.modes
        .filter((m) => m.due && m.dueAt)
        .flatMap((m) => {
          const activity = unit.activities.find(
            (a) => a.delivery === "practice" && a.targetIds.includes(p.target.id),
          );
          if (!activity || !m.dueAt) return [];
          return [
            {
              reference: {
                version: course.version,
                unitId: unit.id,
                activityKey: activity.id,
                mode: "review" as const,
                retrieval: m.retrieval,
              },
              objectiveId: p.target.id,
              dueAt: m.dueAt,
              struggling: m.latest?.outcome === "not-yet" || m.latest?.outcome === "supported",
            },
          ];
        }),
    ),
  );
  return [...outcomeReviews, ...languageReviews].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
export function recommendCourseActivity(course: LearningCourse, state: LearningPathState) {
  const saved = state.activities.find(
    (a) =>
      a.reference.version === course.version &&
      !a.completed &&
      (a.reference.mode === "review" ||
        a.missionId ===
          state.missions.find(
            (m) =>
              m.unitId === a.reference.unitId &&
              m.version === course.version &&
              m.mode === "course",
          )?.id),
  );
  if (saved)
    return { reference: saved.reference, reason: "resume" as const, activityId: saved.activityId };
  const due = dueCourseReviews(course, state)[0];
  if (due) return { reference: due.reference, reason: "review" as const };
  const next = nextCourseActivity(course, state);
  return next ? { reference: next, reason: "course" as const } : null;
}
export function validateCourseEvidence(context: CourseTeachingContext, evidence: CourseEvidence[]) {
  const seen = new Set<string>();
  for (const item of evidence) {
    const objective = context.objectives.find((o) => o.id === item.objectiveId);
    const id = `${item.objectiveId}:${item.skill}`;
    if (!objective?.skills.includes(item.skill) || seen.has(id))
      throw new Error("OD_COURSE_EVIDENCE_INVALID");
    seen.add(id);
    if (
      ["independent", "transfer"].includes(item.outcome) &&
      (context.priorFeedback ||
        item.support.some((s) =>
          ["hint", "model-answer", "translation", "transcript", "repeat-attempt"].includes(s),
        ))
    )
      throw new Error("OD_COURSE_SUPPORT_INVALID");
    if (
      item.skill !== (context.delivery === "practice" ? "writing" : context.delivery) &&
      item.outcome !== "not-evaluated"
    )
      throw new Error("OD_COURSE_MODALITY_INVALID");
  }
  for (const objective of context.objectives)
    if (
      objective.skills.includes(
        (context.delivery === "practice" ? "writing" : context.delivery) as CourseEvidence["skill"],
      ) &&
      !seen.has(`${objective.id}:${context.delivery === "practice" ? "writing" : context.delivery}`)
    )
      throw new Error("OD_COURSE_EVIDENCE_MISSING");
}

export function courseLanguageProgress(
  course: LearningCourse,
  state: LearningPathState,
  unit: CourseUnit,
  now = Date.now(),
) {
  return course.targets
    .filter((t) => unit.targetIds.includes(t.id) && t.kind === "construction")
    .map((target) => {
      const evidence = state.activities
        .filter((a) => a.reference.version === course.version && a.reference.unitId === unit.id)
        .flatMap((a) => a.evidence.filter((e) => e.objectiveId === target.id))
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      const latest = evidence.at(-1) ?? null;
      const modes = (["recognition", "recall", "use"] as const).map((retrieval) => {
        const attempts = evidence.filter(
          (e) => e.retrieval === retrieval && e.outcome !== "not-evaluated",
        );
        const last = attempts.at(-1) ?? null;
        const difficulty = attempts.findLastIndex(
          (e) => !["independent", "transfer"].includes(e.outcome) || e.uncertainty !== "none",
        );
        const successes = new Set(
          attempts.slice(difficulty + 1).map((e) => e.occurredAt.slice(0, 10)),
        ).size;
        const interval = intervals[Math.min(Math.max(0, successes - 1), 4)] ?? 30;
        // Unpractised retrieval modes become due after the target's first encounter.
        const anchor = last?.occurredAt ?? evidence[0]?.occurredAt;
        const dueAt = anchor ? new Date(Date.parse(anchor) + interval * day).toISOString() : null;
        return { retrieval, latest: last, dueAt, due: !!dueAt && Date.parse(dueAt) <= now };
      });
      const dueAt = modes.flatMap((m) => (m.dueAt ? [m.dueAt] : [])).sort()[0] ?? null;
      return {
        target,
        modes,
        latest,
        dueAt,
        due: !!dueAt && Date.parse(dueAt) <= now,
        recognition: evidence.filter((e) => e.retrieval === "recognition").length,
        recall: evidence.filter((e) => e.retrieval === "recall").length,
        use: evidence.filter((e) => e.retrieval === "use").length,
      };
    });
}

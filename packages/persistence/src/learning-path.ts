import { historyAttemptEvidence } from "./attempt-evidence.js";
import {
  parseScopedActivityContext,
  assertLocalLearningScope,
  requireLocalLearningScope,
} from "./learning-context.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  germanNounGender,
  courseEvidenceSchema,
  courseMissionSchema,
  courseTeachingContextSchema,
  learningPathStateSchema,
  learningPathUpdateSchema,
  type CourseEvidence,
  type CourseReference,
  type LearningCourse,
  type LearningScope,
} from "@call-nina/contracts";
import {
  parseSupportedLearningCourse,
  resolveCourseReference,
  validateCourseEvidence,
  vocabularyEntrySchema,
} from "@call-nina/domain";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";

export async function readLearningCourse(curriculumRoot: string): Promise<LearningCourse | null> {
  let source: string;
  try {
    source = await readFile(path.join(curriculumRoot, "learning-path.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("OD_COURSE_UNAVAILABLE");
  }
  if (source.length > 2_000_000) throw new Error("OD_COURSE_INVALID");
  return parseSupportedLearningCourse(JSON.parse(source));
}

export function saveCourseEvidence(
  connection: DatabaseSync,
  input: {
    activityId: string;
    historyEntryId: string;
    occurredAt: string;
    evidence: CourseEvidence[];
    facts?: string;
  },
) {
  const activity = connection
    .prepare("SELECT context_json FROM prepared_activities WHERE activity_id = ?")
    .get(input.activityId) as { context_json: string } | undefined;
  if (!activity) throw new Error("OD_COURSE_ACTIVITY_MISSING");
  const context = parseScopedActivityContext(connection, JSON.parse(activity.context_json));
  const reference = context.learningPath;
  if (!reference || !context.courseTeaching) return;
  const priorResults = connection
    .prepare(
      `SELECT a.context_json, r.evidence_json, r.history_entry_id FROM course_results r JOIN prepared_activities a ON a.activity_id = r.activity_id WHERE json_extract(a.context_json, '$.learningPath.version') = ? AND json_extract(a.context_json, '$.learningPath.unitId') = ? AND r.occurred_at < ? ORDER BY r.occurred_at DESC LIMIT 2000`,
    )
    .all(reference.version, reference.unitId, input.occurredAt) as {
    context_json: string;
    history_entry_id: string;
    evidence_json: string;
  }[];
  const priorIndependent = priorResults.flatMap((row) => {
    if (historyAttemptEvidence(connection, row.history_entry_id)?.basis !== "independent")
      return [];
    const previous = parseScopedActivityContext(connection, JSON.parse(row.context_json));
    if (previous.courseTeaching?.mission.variantId === context.courseTeaching?.mission.variantId)
      return [];
    return courseEvidenceSchema
      .array()
      .parse(JSON.parse(row.evidence_json))
      .filter(
        (e) =>
          ["independent", "transfer"].includes(e.outcome) &&
          e.uncertainty === "none" &&
          !e.support.some((s) =>
            ["hint", "model-answer", "translation", "transcript", "repeat-attempt"].includes(s),
          ),
      );
  });
  const evidence = input.evidence.map((raw) => {
    const e = courseEvidenceSchema.parse(raw);
    if (
      e.outcome === "transfer" &&
      !priorIndependent.some(
        (prior) =>
          prior.objectiveId === e.objectiveId &&
          prior.skill === e.skill &&
          prior.retrieval === e.retrieval,
      )
    )
      e.outcome = "independent";
    return e;
  });
  validateCourseEvidence(context.courseTeaching, evidence);
  connection
    .prepare(
      "INSERT INTO course_results (history_entry_id, activity_id, occurred_at, evidence_json) VALUES (?, ?, ?, ?)",
    )
    .run(input.historyEntryId, input.activityId, input.occurredAt, JSON.stringify(evidence));
  if (input.facts)
    connection
      .prepare("UPDATE course_missions SET facts = ? WHERE mission_id = ?")
      .run(input.facts, context.courseTeaching.mission.id);
  if (reference.mode === "course")
    connection
      .prepare("DELETE FROM course_marks WHERE version = ? AND unit_id = ? AND activity_key = ?")
      .run(reference.version, reference.unitId, reference.activityKey);
}

function createMission(
  connection: DatabaseSync,
  course: LearningCourse,
  reference: CourseReference,
  locale: "en" | "de",
) {
  const { unit } = resolveCourseReference(course, reference);
  const count = (
    connection
      .prepare("SELECT count(*) AS count FROM course_missions WHERE version = ? AND unit_id = ?")
      .get(course.version, unit.id) as { count: number }
  ).count;
  const variant = unit.variants[count % unit.variants.length];
  if (!variant) throw new Error("OD_COURSE_REFERENCE_INVALID");
  const mission = courseMissionSchema.parse({
    id: `mission-${randomUUID()}`,
    version: course.version,
    unitId: unit.id,
    variantId: variant.id,
    mode: reference.mode,
    startedAt: new Date().toISOString(),
    facts: variant.facts[locale],
  });
  connection
    .prepare(
      "INSERT INTO course_missions (mission_id, version, unit_id, variant_id, mode, started_at, facts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      mission.id,
      mission.version,
      mission.unitId,
      mission.variantId,
      mission.mode,
      mission.startedAt,
      mission.facts,
    );
  return mission;
}
const missionSelect =
  "SELECT mission_id AS id, version, unit_id AS unitId, variant_id AS variantId, mode, started_at AS startedAt, facts FROM course_missions";
export async function prepareCourseTeaching(
  database: CallNinaDatabase,
  course: LearningCourse,
  reference: CourseReference,
  locale: "en" | "de",
  scope?: LearningScope,
) {
  const { unit, activity } = resolveCourseReference(course, reference);
  return withLeasedTransaction(database, (connection) => {
    assertCourseScope(connection, course, scope);
    const row =
      reference.mode === "course"
        ? connection
            .prepare(
              `${missionSelect} WHERE version = ? AND unit_id = ? AND mode = 'course' ORDER BY started_at DESC, rowid DESC LIMIT 1`,
            )
            .get(course.version, unit.id)
        : undefined;
    const mission = row
      ? courseMissionSchema.parse(row)
      : createMission(connection, course, reference, locale);
    const targets = course.targets.filter(
      (t) => unit.targetIds.includes(t.id) || unit.reviewTargetIds.includes(t.id),
    );
    const prior = connection
      .prepare(
        "SELECT r.evidence_json FROM course_results r JOIN prepared_activities a ON a.activity_id = r.activity_id WHERE json_extract(a.context_json, '$.courseTeaching.mission.id') = ? AND json_extract(a.context_json, '$.learningPath.activityKey') = ? ORDER BY r.occurred_at DESC LIMIT 3",
      )
      .all(mission.id, activity.id) as { evidence_json: string }[];
    const recentFeedback = prior
      .flatMap((r) => (JSON.parse(r.evidence_json) as CourseEvidence[]).map((e) => e.evidence))
      .slice(0, 3);
    return courseTeachingContextSchema.parse({
      objectives:
        activity.delivery === "practice"
          ? targets
              .filter(
                (t) =>
                  t.kind === "construction" &&
                  unit.targetIds.includes(t.id) &&
                  activity.targetIds.includes(t.id),
              )
              .slice(0, 1)
              .map((t) => ({
                id: t.id,
                targetId: t.id,
                skills: ["writing"],
                description:
                  locale === "de"
                    ? `Erkenne, rufe ab oder verwende das Satzmuster „${t.german}“ im passenden Kontext.`
                    : `Recognise, recall or use the sentence pattern “${t.german}” in context.`,
                criterion:
                  locale === "de"
                    ? `Prüfe genau das Satzmuster „${t.german}“, keine andere Wendung aus dem Modul. Verwende eine neue Person oder Angabe. Beim Wiedererkennen steht das Muster nur in den Antwortoptionen; beim Abrufen und Verwenden nur in optionalen Hinweisen, nicht in der Aufgabe.`
                    : `Assess exactly the construction “${t.german}”, not a neighbouring phrase from the module. Use a new person or detail. Recognition may show the pattern only in answer options; recall and use must keep sentence frames in optional hints, not in the question. Record any support used.`,
              }))
          : unit.objectives
              .filter((o) => activity.objectiveIds.includes(o.id))
              .map((o) => ({
                id: o.id,
                skills: o.skills,
                description: o.description[locale],
                criterion: o.criterion[locale],
              })),
      priorFeedback: prior.length > 0,
      purpose: reference.mode === "review" ? "review" : activity.purpose,
      delivery: activity.delivery,
      mission,
      targetIds: activity.targetIds,
      foundation: JSON.stringify({
        scenario: unit.scenario[locale],
        grammar: unit.grammar[locale],
        explanation: unit.explanation[locale],
        examples: unit.examples,
        targets,
        sharedFacts: mission.facts,
        recentFeedback,
      }),
    });
  });
}
export async function readLearningPathState(database: CallNinaDatabase) {
  return withLeasedConnection(database, (connection) => {
    const scope = requireLocalLearningScope(connection);
    if (scope.targetLanguage !== "de" || scope.courseId === null)
      return learningPathStateSchema.parse({
        selectedStage: "a1-1",
        current: null,
        missions: [],
        marks: [],
        activities: [],
      });
    const selection = connection
      .prepare("SELECT selected_stage, current_json FROM course_selection WHERE singleton = 1")
      .get() as { selected_stage: string; current_json: string | null } | undefined;
    const marks = connection
      .prepare("SELECT version, unit_id, activity_key, status, updated_at FROM course_marks")
      .all() as {
      version: string;
      unit_id: string;
      activity_key: string;
      status: string;
      updated_at: string;
    }[];
    const activities = connection
      .prepare(
        `SELECT a.activity_id, a.context_json, a.status, a.prepared_at, a.completed_at,
      (SELECT count(*) FROM course_results r WHERE r.activity_id = a.activity_id AND r.occurred_at = a.completed_at) AS result_count,
      (SELECT json_array_length(p.output_json, '$.exercises') FROM generated_activity_payloads p WHERE p.activity_id = a.activity_id) AS expected_count
      FROM prepared_activities a WHERE json_type(a.context_json, '$.learningPath') = 'object'
      ORDER BY a.prepared_at DESC LIMIT 2000`,
      )
      .all() as {
      activity_id: string;
      context_json: string;
      status: string;
      prepared_at: string;
      completed_at: string | null;
      result_count: number;
      expected_count: number | null;
    }[];
    return learningPathStateSchema.parse({
      selectedStage: selection?.selected_stage ?? "a1-1",
      current: selection?.current_json ? (JSON.parse(selection.current_json) as unknown) : null,
      missions: connection.prepare(`${missionSelect} ORDER BY started_at DESC LIMIT 2000`).all(),
      marks: marks.map((m) => ({
        reference: {
          version: m.version,
          unitId: m.unit_id,
          activityKey: m.activity_key,
          mode: "course",
        },
        status: m.status,
        updatedAt: m.updated_at,
      })),
      activities: activities.map((a) => {
        const context = parseScopedActivityContext(connection, JSON.parse(a.context_json));
        const results = connection
          .prepare(
            "SELECT history_entry_id, occurred_at, evidence_json FROM course_results WHERE activity_id = ? ORDER BY occurred_at, history_entry_id",
          )
          .all(a.activity_id) as {
          history_entry_id: string;
          occurred_at: string;
          evidence_json: string;
        }[];
        return {
          reference: context.learningPath,
          activityId: a.activity_id,
          missionId: context.courseTeaching?.mission.id,
          variantId: context.courseTeaching?.mission.variantId,
          preparedAt: a.prepared_at,
          completed: a.status === "completed" && a.result_count === (a.expected_count ?? 1),
          historyEntryIds: results.map((r) => r.history_entry_id),
          evidence: results.flatMap((r) => {
            const attemptEvidence = historyAttemptEvidence(connection, r.history_entry_id);
            return (JSON.parse(r.evidence_json) as CourseEvidence[]).map((e) => ({
              ...e,
              // Participation and self-ratings never establish independent proficiency.
              outcome:
                ["independent", "transfer"].includes(e.outcome) &&
                attemptEvidence?.basis !== "independent"
                  ? "supported"
                  : e.outcome,
              occurredAt: r.occurred_at,
              historyEntryId: r.history_entry_id,
              attemptEvidence,
            }));
          }),
        };
      }),
    });
  });
}
export async function updateLearningPath(
  database: CallNinaDatabase,
  course: LearningCourse,
  raw: unknown,
  locale: "en" | "de",
) {
  const input = learningPathUpdateSchema.parse(raw);
  if (input.expectedGeneration !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  const { reference, unit, activity } = resolveCourseReference(course, input.reference);
  if (reference.mode !== "course") throw new Error("OD_COURSE_REFERENCE_INVALID");
  if (input.action === "complete-explanation" && activity.delivery !== "explanation")
    throw new Error("OD_COURSE_COMPLETION_INVALID");
  await withLeasedTransaction(database, (connection) => {
    assertCourseScope(connection, course);
    connection
      .prepare(
        `INSERT INTO course_selection (singleton, selected_stage, current_json) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET selected_stage = excluded.selected_stage, current_json = excluded.current_json`,
      )
      .run(unit.stage, JSON.stringify(reference));
    if (input.action === "new-mission") {
      createMission(connection, course, reference, locale);
      connection
        .prepare("DELETE FROM course_marks WHERE version = ? AND unit_id = ?")
        .run(course.version, unit.id);
      return;
    }
    if (input.action !== "select")
      connection
        .prepare(
          `INSERT INTO course_marks (version, unit_id, activity_key, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(version, unit_id, activity_key) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        )
        .run(
          reference.version,
          reference.unitId,
          reference.activityKey,
          input.action === "complete-explanation"
            ? "completed"
            : input.action === "skip"
              ? "skipped"
              : "not-started",
          new Date().toISOString(),
        );
  });
}

export async function addCourseVocabulary(
  database: CallNinaDatabase,
  course: LearningCourse,
  reference: CourseReference,
  locale: "en" | "de",
) {
  const { unit } = resolveCourseReference(course, reference);
  return withLeasedTransaction(database, (connection) => {
    assertCourseScope(connection, course);
    let added = 0;
    const now = new Date().toISOString();
    for (const target of course.targets.filter(
      (t) => unit.targetIds.includes(t.id) && ["word", "chunk"].includes(t.kind),
    )) {
      if (!target.exampleMeaning) throw new Error("OD_COURSE_REFERENCE_INVALID");
      if (
        connection
          .prepare("SELECT 1 FROM course_vocabulary_links WHERE target_id = ?")
          .get(target.id)
      )
        continue;
      // Link an existing learner entry instead of duplicating the same lexical item.
      const existing = connection
        .prepare(
          "SELECT vocabulary_id FROM vocabulary_entries WHERE lemma = ? AND meaning = ? ORDER BY created_at LIMIT 1",
        )
        .get(target.german, target.meaning[locale]) as { vocabulary_id: string } | undefined;
      const id = existing?.vocabulary_id ?? `vocabulary_${randomUUID().replaceAll("-", "")}`;
      if (!existing) {
        const lexeme =
          target.kind === "chunk"
            ? { partOfSpeech: "phrase", function: target.function, register: target.register }
            : target.article
              ? {
                  partOfSpeech: "noun",
                  nounForm: {
                    article: target.article,
                    gender: germanNounGender(target.article),
                  },
                  plural: target.plural
                    ? { status: "form", form: target.plural }
                    : { status: "unknown" },
                }
              : target.pattern
                ? { partOfSpeech: "verb", pattern: target.pattern }
                : { partOfSpeech: "other" };
        vocabularyEntrySchema.parse({
          targetLanguage: "de",
          schemaVersion: 1,
          vocabularyId: id,
          lemma: target.german,
          meaning: target.meaning[locale],
          lexeme,
          examples: [{ german: target.example, meaning: target.exampleMeaning[locale] }],
          source: {
            kind: "curriculum",
            curriculumTopicId: unit.curriculumTopicIds[0],
            context: unit.title[locale],
          },
          state: { status: "candidate", confirmation: "required" },
        });
        connection
          .prepare(
            "INSERT INTO vocabulary_entries (vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            target.german,
            target.meaning[locale],
            JSON.stringify(lexeme),
            JSON.stringify([{ german: target.example, meaning: target.exampleMeaning[locale] }]),
            JSON.stringify({
              kind: "curriculum",
              curriculumTopicId: unit.curriculumTopicIds[0],
              context: unit.title[locale],
            }),
            now,
            now,
          );
        added++;
      }
      connection
        .prepare("INSERT INTO course_vocabulary_links (target_id, vocabulary_id) VALUES (?, ?)")
        .run(target.id, id);
    }
    return added;
  });
}

function assertCourseScope(
  connection: DatabaseSync,
  course: LearningCourse,
  requestedScope?: LearningScope,
) {
  const scope = requestedScope ?? requireLocalLearningScope(connection);
  if (scope.targetLanguage !== course.targetLanguage || scope.courseId !== course.courseId)
    throw new Error("OD_COURSE_UNAVAILABLE");
  assertLocalLearningScope(connection, {
    ...scope,
    courseId: course.courseId,
    targetLanguage: course.targetLanguage,
  });
}

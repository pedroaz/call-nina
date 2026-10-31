import {
  evaluateExerciseAnswer,
  startedExerciseSnapshotSchema,
  exerciseAnswerSchema,
} from "@call-nina/domain";
import { createHash, randomUUID } from "node:crypto";
import {
  vocabularyAnalysisOutputSchema,
  vocabularyLearningSnapshotSchema,
  vocabularyIdentity,
  vocabularyLexemeMatchesLanguage,
  vocabularyLexemeSchema,
  type Language,
  type z,
  type DesktopIpcRequest,
} from "@call-nina/contracts";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";
import {
  requireLocalLearningScope,
  readLocalLearningScope,
  scopeForLanguage,
  activityLearningScope,
} from "./learning-context.js";
import { vocabularyEntryFromRow } from "./repository-support.js";
import type { DatabaseSync } from "node:sqlite";

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const identity = (
  word: { lemma: string; meaning: string; lexeme: z.infer<typeof vocabularyLexemeSchema> },
  language: Language,
) => vocabularyIdentity(word, language);

export function ingestVocabularyInTransaction(
  connection: DatabaseSync,
  input: {
    language: Language;
    sourceKey: string;
    output: z.infer<typeof vocabularyAnalysisOutputSchema>;
    focus?: { guidance: string; text: string };
    activityId?: string;
    uploadRevisionId?: string;
  },
) {
  const output = vocabularyAnalysisOutputSchema.parse(input.output);
  if (
    !output.readable ||
    output.words.some((w) => !vocabularyLexemeMatchesLanguage(w.lexeme, input.language))
  )
    throw new Error("OD_VOCABULARY_SOURCE_UNREADABLE");
  scopeForLanguage(connection, input.language);
  const previous = connection
    .prepare("SELECT id FROM vocabulary_batches WHERE target_language = ? AND source_key = ?")
    .get(input.language, input.sourceKey);
  if (previous) {
    connection
      .prepare("UPDATE vocabulary_evidence_jobs SET state='done' WHERE source_key=?")
      .run(input.sourceKey);
    return;
  }
  const now = new Date().toISOString();
  const batchId = id("vocabulary-batch");
  const focusId = input.focus ? id("vocabulary-focus") : null;
  if (input.focus)
    connection
      .prepare(
        "INSERT INTO vocabulary_focuses(id,target_language,title,guidance,source_text,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(focusId, input.language, output.title, input.focus.guidance, input.focus.text, now);
  connection
    .prepare(
      "INSERT INTO vocabulary_batches(id,target_language,source_key,title,created_at,focus_id,activity_id) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      batchId,
      input.language,
      input.sourceKey,
      output.title,
      now,
      focusId,
      input.activityId ?? null,
    );
  const rows = connection
    .prepare("SELECT * FROM vocabulary_entries WHERE target_language = ? ORDER BY created_at")
    .all(input.language);
  const existing = new Map(
    rows.map((row) => {
      const entry = vocabularyEntryFromRow(row);
      return [identity(entry, input.language), row];
    }),
  );
  for (const word of output.words) {
    const key = identity(word, input.language);
    if (!input.uploadRevisionId) {
      const suppressed = connection
        .prepare("SELECT identity FROM vocabulary_suppressions WHERE target_language=?")
        .all(input.language)
        .some((r) => {
          const saved = JSON.parse(String(r["identity"])) as string[];
          const current = JSON.parse(key) as string[];
          return (
            saved[1] === current[1] &&
            saved[3] === current[3] &&
            (saved[2] === current[2] || saved[2] === "other" || current[2] === "other")
          );
        });
      if (suppressed) continue;
    }
    const exact = existing.get(key);
    const sameMeaning = rows.filter(
      (r) =>
        String(r["lemma"]).toLocaleLowerCase() === word.lemma.toLocaleLowerCase() &&
        String(r["meaning"]).toLocaleLowerCase() === word.meaning.toLocaleLowerCase(),
    );
    const singleMeaning = sameMeaning.length === 1 ? sameMeaning[0] : undefined;
    const old =
      exact ??
      (singleMeaning &&
      (word.lexeme.partOfSpeech === "other" ||
        vocabularyLexemeSchema.parse(JSON.parse(String(singleMeaning["lexeme_json"])))
          .partOfSpeech === "other")
        ? singleMeaning
        : undefined);
    if (
      (!input.uploadRevisionId && old?.["status"] === "suspended") ||
      (!old && word.outcome === "success")
    )
      continue;
    const wordId = old ? String(old["vocabulary_id"]) : id("vocabulary");
    const added = !old || (!input.uploadRevisionId && old["status"] === "candidate");
    if (!old) {
      connection
        .prepare(
          `INSERT INTO vocabulary_entries(target_language,vocabulary_id,lemma,meaning,lexeme_json,examples_json,source_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          input.language,
          wordId,
          word.lemma,
          word.meaning,
          JSON.stringify(word.lexeme),
          JSON.stringify(word.examples),
          JSON.stringify({ kind: "learner", context: word.reason.slice(0, 500) }),
          now,
          now,
        );
      const inserted = connection
        .prepare("SELECT * FROM vocabulary_entries WHERE vocabulary_id = ?")
        .get(wordId);
      if (!inserted) throw new Error("OD_VOCABULARY_INSERT_MISSING");
      existing.set(key, inserted);
    }
    if (added)
      connection
        .prepare(
          "UPDATE vocabulary_entries SET status='active',confirmed_at=?,due_on=substr(?,1,10),stage=1,updated_at=?,revision=revision+1 WHERE vocabulary_id=? AND status='candidate'",
        )
        .run(now, now, now, wordId);
    if (input.uploadRevisionId)
      connection
        .prepare(
          "INSERT OR IGNORE INTO upload_words(upload_revision_id,vocabulary_id,created_at) VALUES (?,?,?)",
        )
        .run(input.uploadRevisionId, wordId, now);
    connection
      .prepare("INSERT OR IGNORE INTO vocabulary_observations VALUES (?,?,?,?,?,?,?,?)")
      .run(
        batchId,
        wordId,
        word.reason,
        word.excerpt,
        word.outcome,
        Number(added),
        Number(!old),
        word.attemptId,
      );
  }
  connection
    .prepare(
      `UPDATE vocabulary_batches SET is_read=1 WHERE id=? AND NOT EXISTS (
    SELECT 1 FROM vocabulary_observations WHERE batch_id=? AND (was_added=1 OR outcome='difficulty'))`,
    )
    .run(batchId, batchId);
  connection
    .prepare("UPDATE vocabulary_evidence_jobs SET state='done' WHERE source_key=?")
    .run(input.sourceKey);
  if (input.activityId)
    connection
      .prepare("DELETE FROM vocabulary_analysis_queue WHERE activity_id=? AND source_key=?")
      .run(input.activityId, input.sourceKey);
}

export async function ingestVocabulary(
  database: CallNinaDatabase,
  input: Parameters<typeof ingestVocabularyInTransaction>[1],
) {
  return withLeasedTransaction(database, (connection) =>
    ingestVocabularyInTransaction(connection, input),
  );
}

export async function readVocabularyLearning(database: CallNinaDatabase, activityId?: string) {
  return withLeasedConnection(database, (connection) => {
    const language = requireLocalLearningScope(connection).targetLanguage;
    const focuses = connection
      .prepare(
        "SELECT * FROM vocabulary_focuses WHERE target_language=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(language)
      .map((r) => ({
        id: r["id"],
        title: r["title"],
        guidance: r["guidance"],
        text: r["source_text"],
        active: Boolean(r["active"]),
        createdAt: r["created_at"],
      }));
    const batches = connection
      .prepare(
        "SELECT * FROM vocabulary_batches WHERE target_language=? AND (? IS NULL OR activity_id=?) ORDER BY is_read,created_at DESC LIMIT ?",
      )
      .all(language, activityId ?? null, activityId ?? null, activityId ? 500 : 50)
      .map((r) => {
        const words = connection
          .prepare(
            "SELECT v.vocabulary_id,v.lemma,v.meaning,v.examples_json,o.reason,o.was_added,o.outcome FROM vocabulary_observations o JOIN vocabulary_entries v USING(vocabulary_id) WHERE batch_id=?",
          )
          .all(String(r["id"]));
        return {
          id: r["id"],
          activityId: r["activity_id"],
          title: r["title"],
          createdAt: r["created_at"],
          read: Boolean(r["is_read"]),
          undone: Boolean(r["undone"]),
          added: words.filter((w) => w["was_added"] === 1).length,
          focusId: r["focus_id"],
          source: connection
            .prepare(
              "SELECT 1 FROM vocabulary_evidence_jobs WHERE source_key=? AND output_json IS NOT NULL",
            )
            .get(String(r["source_key"]))
            ? "writing"
            : String(r["source_key"]).startsWith("activity:")
              ? "practice"
              : String(r["source_key"]).startsWith("correction:")
                ? "writing"
                : "content",
          words: words.map((w) => ({
            vocabularyId: w["vocabulary_id"],
            lemma: w["lemma"],
            meaning: w["meaning"],
            reason: w["reason"],
            examples: JSON.parse(String(w["examples_json"])) as unknown,
            added: w["was_added"] === 1,
            outcome: w["outcome"],
          })),
        };
      });
    const pendingActivities = connection
      .prepare(
        "SELECT q.activity_id AS activityId,p.title FROM vocabulary_analysis_queue q JOIN prepared_activities p USING(activity_id) WHERE q.target_language=? LIMIT 50",
      )
      .all(language);
    return vocabularyLearningSnapshotSchema.parse({
      rootGeneration: database.rootGeneration,
      language,
      focuses,
      unreadCount: Number(
        connection
          .prepare(
            `SELECT COUNT(DISTINCT o.vocabulary_id) AS count FROM vocabulary_observations o JOIN vocabulary_batches b ON b.id=o.batch_id WHERE b.target_language=? AND b.is_read=0 AND b.undone=0 AND (o.was_added=1 OR o.outcome='difficulty')`,
          )
          .get(language)?.["count"] ?? 0,
      ),
      dueWords: connection
        .prepare(
          "SELECT lemma FROM vocabulary_entries WHERE target_language=? AND status='active' AND due_on<=date('now') ORDER BY due_on LIMIT 3",
        )
        .all(language)
        .map((r) => r["lemma"]),
      batches,
      pendingActivities,
      jobs: connection
        .prepare(
          "SELECT DISTINCT activity_id AS activityId,state FROM vocabulary_evidence_jobs WHERE target_language=? AND state<>'done' LIMIT 500",
        )
        .all(language),
    });
  });
}

export async function updateVocabularyLearning(
  database: CallNinaDatabase,
  input: Extract<DesktopIpcRequest, { channel: "vocabulary/learning-update" }>["payload"],
) {
  if (input.rootGeneration !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  await withLeasedTransaction(database, (connection) => {
    const language = requireLocalLearningScope(connection).targetLanguage;
    const action = input.action;
    if (action.kind === "read") {
      connection
        .prepare(
          "UPDATE vocabulary_batches SET is_read=1 WHERE target_language=? AND id IN (SELECT value FROM json_each(?))",
        )
        .run(language, JSON.stringify(action.batchIds));
    } else if (action.kind === "retry") {
      connection
        .prepare(
          "UPDATE vocabulary_evidence_jobs SET state='pending',tries=0,next_at=0 WHERE activity_id=? AND target_language=? AND state IN ('failed','blocked')",
        )
        .run(action.activityId, language);
    } else if (action.kind === "focus") {
      connection
        .prepare(
          "UPDATE vocabulary_focuses SET title=?,active=?,source_text=? WHERE id=? AND target_language=?",
        )
        .run(action.title, Number(action.active), action.text, action.focusId, language);
    } else {
      const batch = connection
        .prepare("SELECT * FROM vocabulary_batches WHERE id=? AND target_language=? AND undone=0")
        .get(action.batchId, language);
      if (!batch) return;
      const words = connection
        .prepare(
          "SELECT v.*,o.was_added,o.was_created FROM vocabulary_observations o JOIN vocabulary_entries v USING(vocabulary_id) WHERE batch_id=?",
        )
        .all(action.batchId);
      connection
        .prepare("UPDATE vocabulary_batches SET undone=1,is_read=1 WHERE id=?")
        .run(action.batchId);
      if (batch["focus_id"])
        connection
          .prepare("UPDATE vocabulary_focuses SET active=0 WHERE id=?")
          .run(batch["focus_id"]);
      for (const row of words) {
        if (!row["was_added"]) continue;
        const wordId = String(row["vocabulary_id"]);
        const later = connection
          .prepare(
            `SELECT 1 FROM vocabulary_observations o JOIN vocabulary_batches b ON b.id=o.batch_id WHERE o.vocabulary_id=? AND b.id<>? AND b.undone=0 LIMIT 1`,
          )
          .get(wordId, action.batchId);
        const reviewed = connection
          .prepare("SELECT 1 FROM vocabulary_reviews WHERE vocabulary_id=? LIMIT 1")
          .get(wordId);
        if (later || reviewed || String(row["updated_at"]) > String(batch["created_at"])) continue;
        if (row["was_created"]) {
          connection
            .prepare("INSERT INTO vocabulary_deletions(vocabulary_id,deleted_at) VALUES (?,?)")
            .run(wordId, new Date().toISOString());
          connection.prepare("DELETE FROM vocabulary_entries WHERE vocabulary_id=?").run(wordId);
        } else if (row["status"] === "active") {
          connection
            .prepare(
              "UPDATE vocabulary_entries SET status='candidate',revision=0,confirmed_at=NULL,due_on=NULL,stage=NULL,updated_at=? WHERE vocabulary_id=?",
            )
            .run(new Date().toISOString(), wordId);
        }
      }
    }
  });
  return readVocabularyLearning(database);
}

export async function vocabularyPracticeContext(database: CallNinaDatabase, language: Language) {
  return withLeasedConnection(database, (connection) => {
    const words = connection
      .prepare(
        `SELECT v.* FROM vocabulary_entries v LEFT JOIN (
      SELECT o.vocabulary_id, SUM(CASE o.outcome WHEN 'difficulty' THEN 2 WHEN 'success' THEN -1 ELSE 0 END) AS difficulty,
      MAX(CASE WHEN f.active=1 THEN 1 ELSE 0 END) AS focused
      FROM vocabulary_observations o JOIN vocabulary_batches b ON b.id=o.batch_id LEFT JOIN vocabulary_focuses f ON f.id=b.focus_id
      WHERE b.undone=0 GROUP BY o.vocabulary_id
    ) evidence USING(vocabulary_id) WHERE v.target_language=? AND v.status='active' AND (COALESCE(difficulty,0)>0 OR v.due_on<=date('now') OR COALESCE(focused,0)=1)
    ORDER BY COALESCE(difficulty,0) DESC, (v.due_on<=date('now')) DESC,COALESCE(focused,0) DESC,v.due_on LIMIT 12`,
      )
      .all(language)
      .map(vocabularyEntryFromRow);
    const focuses = connection
      .prepare(
        "SELECT title,guidance,source_text FROM vocabulary_focuses WHERE target_language=? AND active=1 ORDER BY created_at DESC LIMIT 10",
      )
      .all(language)
      .map((r) =>
        `${String(r["title"])}: ${String(r["guidance"])}\n${String(r["source_text"])}`.slice(
          0,
          2000,
        ),
      );
    return { words, focuses };
  });
}

// Called inside the same transaction that saves the evaluated answer.
export function queueVocabularyEvidence(
  connection: DatabaseSync,
  activityId: string,
  attemptId: string,
) {
  const scope = activityLearningScope(connection, activityId);
  const row = connection
    .prepare(
      `SELECT a.exercise_snapshot_json,an.answer_json,f.feedback_json,
    COALESCE(s.hints_used,0)+COALESCE(s.helper_used,0)+COALESCE(s.translation_used,0) AS assisted
    FROM attempts a JOIN exercises e USING(exercise_id) JOIN answers an ON an.attempt_id=a.attempt_id AND an.position=0
    LEFT JOIN exercise_attempt_feedback f ON f.attempt_id=a.attempt_id
    LEFT JOIN exercise_support s ON s.attempt_id=a.attempt_id WHERE a.attempt_id=? AND e.activity_id=?`,
    )
    .get(attemptId, activityId);
  if (!row) return;
  const exercise = startedExerciseSnapshotSchema.parse(
    JSON.parse(String(row["exercise_snapshot_json"])),
  );
  const answer = exerciseAnswerSchema.parse(JSON.parse(String(row["answer_json"])));
  const evaluation = evaluateExerciseAnswer(exercise.exercise, answer, scope.targetLanguage);
  if (evaluation.status === "requires-ai" && !row["feedback_json"]) return;
  const feedback = row["feedback_json"] ? JSON.parse(String(row["feedback_json"])) : evaluation;
  const revision = createHash("sha256").update(JSON.stringify(feedback)).digest("hex");
  const courseSupport = connection
    .prepare("SELECT * FROM course_activity_support WHERE activity_id=?")
    .get(activityId);
  const sourceText = JSON.stringify([
    {
      attemptId,
      exercise,
      answer,
      feedback,
      assisted: Boolean(
        row["assisted"] ||
        courseSupport?.["hints_used"] ||
        courseSupport?.["helper_used"] ||
        courseSupport?.["translation_used"],
      ),
    },
  ]);
  enqueueVocabularyEvidence(connection, { activityId, attemptId, revision, sourceText });
}

export function enqueueVocabularyEvidence(
  connection: DatabaseSync,
  input: {
    activityId: string;
    attemptId: string;
    revision: string;
    sourceText: string;
    output?: z.infer<typeof vocabularyAnalysisOutputSchema>;
  },
) {
  const scope = activityLearningScope(connection, input.activityId);
  const sourceKey = `activity:${input.activityId}:${input.attemptId}:${input.revision.slice(0, 16)}`;
  connection
    .prepare(
      `INSERT OR IGNORE INTO vocabulary_evidence_jobs
    (source_key,learner_id,target_language,activity_id,attempt_id,revision,source_text,output_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      sourceKey,
      scope.learnerId,
      scope.targetLanguage,
      input.activityId,
      input.attemptId,
      input.revision,
      input.sourceText,
      input.output ? JSON.stringify(input.output) : null,
      new Date().toISOString(),
    );
}

export async function queueVocabularyAnalysis(
  database: CallNinaDatabase,
  activityId: string,
  attemptIds: readonly string[],
) {
  return withLeasedTransaction(database, (connection) => {
    for (const attemptId of attemptIds) queueVocabularyEvidence(connection, activityId, attemptId);
    return true;
  });
}
export async function readVocabularyAnalysis(
  database: CallNinaDatabase,
  activityId: string,
  sourceKey?: string,
) {
  return withLeasedConnection(database, (connection) => {
    const row = sourceKey
      ? connection
          .prepare("SELECT * FROM vocabulary_evidence_jobs WHERE activity_id=? AND source_key=?")
          .get(activityId, sourceKey)
      : connection
          .prepare(
            "SELECT * FROM vocabulary_evidence_jobs WHERE activity_id=? AND state<>'done' ORDER BY created_at LIMIT 1",
          )
          .get(activityId);
    if (!row) throw new Error("OD_VOCABULARY_ANALYSIS_UNAVAILABLE");
    const scope = activityLearningScope(connection, activityId);
    const attempts = JSON.parse(String(row["source_text"])) as Array<{
      exercise: { exercise: { targetedVocabularyIds?: string[] } };
    }>;
    const targets = attempts.flatMap((a) => a.exercise.exercise.targetedVocabularyIds ?? []);
    const knownWords = connection
      .prepare(
        "SELECT vocabulary_id AS vocabularyId,lemma,meaning FROM vocabulary_entries WHERE target_language=? AND status='active' AND vocabulary_id IN (SELECT value FROM json_each(?)) LIMIT 100",
      )
      .all(scope.targetLanguage, JSON.stringify(targets))
      .map((w) => ({
        vocabularyId: String(w["vocabularyId"]),
        lemma: String(w["lemma"]),
        meaning: String(w["meaning"]),
      }));
    return {
      scope,
      knownWords,
      sourceKey: String(row["source_key"]),
      sourceText: String(row["source_text"]),
    };
  });
}

export async function resumeVocabularyEvidence(database: CallNinaDatabase) {
  await withLeasedTransaction(database, (connection) => {
    connection
      .prepare(
        "UPDATE vocabulary_evidence_jobs SET state='pending',next_at=0,tries=max(0,tries-1) WHERE state='running'",
      )
      .run();
    for (const row of connection.prepare("SELECT * FROM vocabulary_analysis_queue").all()) {
      for (const attempt of JSON.parse(String(row["source_text"])) as Array<{
        attemptId: string;
      }>) {
        // Existing completed batches already have evidence; only resume unprocessed legacy work.
        if (
          !connection
            .prepare("SELECT 1 FROM vocabulary_batches WHERE source_key=?")
            .get(String(row["source_key"]))
        )
          queueVocabularyEvidence(connection, String(row["activity_id"]), attempt.attemptId);
      }
    }
    connection.prepare("DELETE FROM vocabulary_analysis_queue").run();
  });
}
export async function claimVocabularyEvidence(database: CallNinaDatabase) {
  return withLeasedTransaction(database, (connection) => {
    const scope = readLocalLearningScope(connection);
    if (!scope) return undefined;
    const row = connection
      .prepare(
        "SELECT * FROM vocabulary_evidence_jobs WHERE learner_id=? AND target_language=? AND state='pending' AND next_at<=? ORDER BY created_at LIMIT 1",
      )
      .get(scope.learnerId, scope.targetLanguage, Date.now());
    if (!row) return undefined;
    connection
      .prepare(
        "UPDATE vocabulary_evidence_jobs SET state='running',tries=tries+1 WHERE source_key=?",
      )
      .run(String(row["source_key"]));
    return {
      sourceKey: String(row["source_key"]),
      activityId: String(row["activity_id"]),
      language: scope.targetLanguage,
      output: row["output_json"]
        ? vocabularyAnalysisOutputSchema.parse(JSON.parse(String(row["output_json"])))
        : undefined,
    };
  });
}
export async function settleVocabularyFailure(
  database: CallNinaDatabase,
  sourceKey: string,
  blocked = false,
) {
  await withLeasedTransaction(database, (connection) => {
    connection
      .prepare(
        `UPDATE vocabulary_evidence_jobs SET state=CASE WHEN ? THEN 'blocked' WHEN tries>=3 THEN 'failed' ELSE 'pending' END,
      next_at=? + CASE WHEN tries=1 THEN 5000 ELSE 30000 END WHERE source_key=? AND state='running'`,
      )
      .run(Number(blocked), Date.now(), sourceKey);
  });
}
export async function retryBlockedVocabulary(database: CallNinaDatabase) {
  await withLeasedTransaction(database, (c) => {
    c.prepare(
      "UPDATE vocabulary_evidence_jobs SET state='pending',tries=0,next_at=0 WHERE state='blocked'",
    ).run();
  });
}

export async function hasBlockedVocabulary(database: CallNinaDatabase) {
  return withLeasedConnection(database, (connection) =>
    Boolean(
      connection
        .prepare("SELECT 1 FROM vocabulary_evidence_jobs WHERE state='blocked' LIMIT 1")
        .get(),
    ),
  );
}

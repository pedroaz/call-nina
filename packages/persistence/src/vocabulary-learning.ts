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
  scopeForLanguage,
  activityLearningScope,
} from "./learning-context.js";
import { vocabularyEntryFromRow } from "./repository-support.js";

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const identity = (
  word: { lemma: string; meaning: string; lexeme: z.infer<typeof vocabularyLexemeSchema> },
  language: Language,
) => vocabularyIdentity(word, language);

export async function ingestVocabulary(
  database: CallNinaDatabase,
  input: {
    language: Language;
    sourceKey: string;
    output: z.infer<typeof vocabularyAnalysisOutputSchema>;
    focus?: { guidance: string; text: string };
    activityId?: string;
  },
) {
  const output = vocabularyAnalysisOutputSchema.parse(input.output);
  if (
    !output.readable ||
    output.words.some((w) => !vocabularyLexemeMatchesLanguage(w.lexeme, input.language))
  )
    throw new Error("OD_VOCABULARY_SOURCE_UNREADABLE");
  return withLeasedTransaction(database, (connection) => {
    scopeForLanguage(connection, input.language);
    const previous = connection
      .prepare("SELECT id FROM vocabulary_batches WHERE target_language = ? AND source_key = ?")
      .get(input.language, input.sourceKey);
    if (previous) return;
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
        "INSERT INTO vocabulary_batches(id,target_language,source_key,title,created_at,focus_id) VALUES (?,?,?,?,?,?)",
      )
      .run(batchId, input.language, input.sourceKey, output.title, now, focusId);
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
      if (
        connection
          .prepare(
            "SELECT 1 FROM vocabulary_suppressions WHERE target_language = ? AND identity = ?",
          )
          .get(input.language, key)
      )
        continue;
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
      if (old?.["status"] === "suspended" || (!old && word.outcome === "success")) continue;
      const wordId = old ? String(old["vocabulary_id"]) : id("vocabulary");
      const added = !old || old["status"] === "candidate";
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
    if (input.activityId)
      connection
        .prepare("DELETE FROM vocabulary_analysis_queue WHERE activity_id=? AND source_key=?")
        .run(input.activityId, input.sourceKey);
  });
}

export async function readVocabularyLearning(database: CallNinaDatabase) {
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
        "SELECT * FROM vocabulary_batches WHERE target_language=? ORDER BY created_at DESC LIMIT 50",
      )
      .all(language)
      .map((r) => {
        const words = connection
          .prepare(
            "SELECT v.vocabulary_id,v.lemma,v.meaning,v.examples_json,o.reason,o.was_added FROM vocabulary_observations o JOIN vocabulary_entries v USING(vocabulary_id) WHERE batch_id=?",
          )
          .all(String(r["id"]));
        return {
          id: r["id"],
          title: r["title"],
          createdAt: r["created_at"],
          read: Boolean(r["is_read"]),
          undone: Boolean(r["undone"]),
          added: words.filter((w) => w["was_added"] === 1).length,
          focusId: r["focus_id"],
          source: String(r["source_key"]).startsWith("activity:")
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
      dueWords: connection
        .prepare(
          "SELECT lemma FROM vocabulary_entries WHERE target_language=? AND status='active' AND due_on<=date('now') ORDER BY due_on LIMIT 3",
        )
        .all(language)
        .map((r) => r["lemma"]),
      batches,
      pendingActivities,
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
        .prepare("UPDATE vocabulary_batches SET is_read=1 WHERE target_language=?")
        .run(language);
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
    ) evidence USING(vocabulary_id) WHERE v.target_language=? AND v.status='active'
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

export async function queueVocabularyAnalysis(
  database: CallNinaDatabase,
  activityId: string,
  attemptIds: readonly string[],
) {
  return withLeasedTransaction(database, (connection) => {
    const scope = activityLearningScope(connection, activityId);
    const rows = connection
      .prepare(
        `SELECT a.attempt_id,a.exercise_snapshot_json,a.feedback_json,a.objective_evaluations_json,an.answer_json,
      COALESCE(s.hints_used,0) AS hints,COALESCE(s.helper_used,0) AS helper,COALESCE(s.translation_used,0) AS translation
      FROM attempts a JOIN exercises e USING(exercise_id) JOIN answers an ON an.attempt_id=a.attempt_id AND an.position=0
      LEFT JOIN exercise_support s ON s.attempt_id=a.attempt_id WHERE e.activity_id=? AND a.status='completed' AND a.attempt_id IN (SELECT value FROM json_each(?)) ORDER BY a.started_at DESC LIMIT 30`,
      )
      .all(activityId, JSON.stringify(attemptIds));
    if (!rows.length) return false;
    const assistedCourse = connection
      .prepare("SELECT * FROM course_activity_support WHERE activity_id=?")
      .get(activityId);
    const sourceText = JSON.stringify(
      rows.map((r) => ({
        attemptId: r["attempt_id"],
        exercise: JSON.parse(String(r["exercise_snapshot_json"])) as unknown,
        answer: JSON.parse(String(r["answer_json"])) as unknown,
        feedback: JSON.parse(String(r["feedback_json"])) as unknown,
        assisted: Boolean(
          r["hints"] ||
          r["helper"] ||
          r["translation"] ||
          assistedCourse?.["hints_used"] ||
          assistedCourse?.["helper_used"] ||
          assistedCourse?.["translation_used"],
        ),
      })),
    );
    const key = `activity:${activityId}:${createHash("sha256").update(sourceText).digest("hex")}`;
    if (connection.prepare("SELECT 1 FROM vocabulary_batches WHERE source_key=?").get(key))
      return false;
    if (sourceText.length > 120000) return false;
    connection
      .prepare(
        "INSERT INTO vocabulary_analysis_queue VALUES (?,?,?,?) ON CONFLICT(activity_id) DO UPDATE SET source_key=excluded.source_key,source_text=excluded.source_text",
      )
      .run(activityId, scope.targetLanguage, key, sourceText);
    return true;
  });
}
export async function readVocabularyAnalysis(database: CallNinaDatabase, activityId: string) {
  return withLeasedConnection(database, (connection) => {
    const row = connection
      .prepare("SELECT * FROM vocabulary_analysis_queue WHERE activity_id=?")
      .get(activityId);
    if (!row) throw new Error("OD_VOCABULARY_ANALYSIS_UNAVAILABLE");
    const scope = activityLearningScope(connection, activityId);
    return { scope, sourceKey: String(row["source_key"]), sourceText: String(row["source_text"]) };
  });
}

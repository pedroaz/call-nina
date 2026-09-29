import type { DatabaseSync } from "node:sqlite";
import {
  exerciseGenerationCandidateSchema,
  parsePortableExerciseContent,
  portableFlashcardContentSchema,
  vocabularyExampleSchema,
  vocabularyLexemeSchema,
  vocabularyLexemeMatchesLanguage,
  languageSchema,
  z,
} from "@call-nina/contracts";

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("OD_TEACHING_MIGRATION_INVALID");
  return value as Record<string, unknown>;
}

function rename(value: unknown, before: string, after: string): Record<string, unknown> {
  const entry = object(value);
  if (!(before in entry)) return entry;
  if (after in entry) throw new Error("OD_TEACHING_MIGRATION_AMBIGUOUS");
  const { [before]: original, ...rest } = entry;
  return { ...rest, [after]: original };
}

/** Only ledger migrations call these converters; current readers accept one contract. */
export function migrateVocabularyExamples(value: unknown) {
  if (!Array.isArray(value)) throw new Error("OD_TEACHING_MIGRATION_INVALID");
  return z
    .array(vocabularyExampleSchema)
    .min(1)
    .max(12)
    .parse(value.map((entry: unknown) => rename(entry, "german", "text")));
}

export function migrateFlashcardFields(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("OD_TEACHING_MIGRATION_INVALID");
  return value.map((value: unknown) => {
    const card = object(value);
    return { ...card, examples: migrateVocabularyExamples(card["examples"]) };
  });
}

export function migrateExerciseFields(value: unknown) {
  const payload = object(value);
  let lesson = payload["lesson"];
  if (lesson !== null && lesson !== undefined) {
    const fields = object(lesson);
    const words = fields["vocabularyFoundations"];
    if (!Array.isArray(words)) throw new Error("OD_TEACHING_MIGRATION_INVALID");
    lesson = {
      ...fields,
      vocabularyFoundations: words.map((entry: unknown) => rename(entry, "german", "term")),
    };
  }
  return exerciseGenerationCandidateSchema.parse({
    ...payload,
    ...(lesson === undefined ? {} : { lesson }),
  });
}

/** Migration 31 changes field names only, inside the ledger transaction. No IDs or text change. */
export function migrateMultilingualTeaching(connection: DatabaseSync) {
  for (const row of connection
    .prepare(
      "SELECT vocabulary_id, target_language, lexeme_json, examples_json FROM vocabulary_entries",
    )
    .all()) {
    const language = languageSchema.parse(row["target_language"]);
    const lexeme = vocabularyLexemeSchema.parse(JSON.parse(String(row["lexeme_json"])));
    if (!vocabularyLexemeMatchesLanguage(lexeme, language))
      throw new Error("OD_VOCABULARY_LANGUAGE_INVALID");
    const examples = migrateVocabularyExamples(JSON.parse(String(row["examples_json"])));
    connection
      .prepare("UPDATE vocabulary_entries SET examples_json = ? WHERE vocabulary_id = ?")
      .run(JSON.stringify(examples), String(row["vocabulary_id"]));
  }
  for (const row of connection
    .prepare("SELECT activity_id, output_json FROM generated_activity_payloads")
    .all()) {
    const content = object(JSON.parse(String(row["output_json"])));
    if (content["schemaVersion"] !== 1) throw new Error("OD_CONTENT_VERSION_UNSUPPORTED");
    const converted = parsePortableExerciseContent({
      ...content,
      payload: migrateExerciseFields(content["payload"]),
    });
    connection
      .prepare("UPDATE generated_activity_payloads SET output_json = ? WHERE activity_id = ?")
      .run(JSON.stringify(converted), String(row["activity_id"]));
  }
  for (const row of connection
    .prepare("SELECT activity_id, content_json FROM flashcard_decks")
    .all()) {
    const content = object(JSON.parse(String(row["content_json"])));
    if (content["schemaVersion"] !== 1) throw new Error("OD_CONTENT_VERSION_UNSUPPORTED");
    const converted = portableFlashcardContentSchema.parse({
      ...content,
      cards: migrateFlashcardFields(content["cards"]),
    });
    connection
      .prepare("UPDATE flashcard_decks SET content_json = ? WHERE activity_id = ?")
      .run(JSON.stringify(converted), String(row["activity_id"]));
  }
  connection.exec(`
    CREATE TRIGGER generated_activity_payload_immutable BEFORE UPDATE ON generated_activity_payloads
      BEGIN SELECT RAISE(ABORT, 'OD_GENERATED_ACTIVITY_IMMUTABLE'); END;
    CREATE TRIGGER flashcard_content_immutable BEFORE UPDATE OF activity_id, source, content_json ON flashcard_decks
      BEGIN SELECT RAISE(ABORT, 'OD_CONTENT_REVISION_IMMUTABLE'); END;
  `);
}

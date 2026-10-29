import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { storyCatalogSchema, type Story, type LearningContext } from "@call-nina/contracts";
import { vocabularyEntrySchema } from "@call-nina/domain";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";
import { assertLocalLearningScope } from "./learning-context.js";

export async function readStories(root: string) {
  const source = await readFile(path.join(root, "stories", "catalog.json"), "utf8");
  if (source.length > 4_000_000) throw new Error("OD_STORIES_INVALID");
  return storyCatalogSchema.parse(JSON.parse(source)).stories;
}
export async function storyPositions(db: CallNinaDatabase, context: LearningContext) {
  return withLeasedConnection(db, (connection) => {
    assertLocalLearningScope(connection, context);
    return Object.fromEntries(
      connection
        .prepare(
          "SELECT story_id,paragraph FROM story_positions WHERE learner_id=? AND target_language=?",
        )
        .all(context.learnerId, context.targetLanguage)
        .map((row) => [String(row["story_id"]), Number(row["paragraph"])]),
    );
  });
}
export async function saveStoryPosition(
  db: CallNinaDatabase,
  context: LearningContext,
  story: Story,
  paragraph: number,
) {
  if (story.language !== context.targetLanguage || !story.paragraphs[paragraph])
    throw new Error("OD_STORY_REFERENCE_INVALID");
  await withLeasedTransaction(db, (connection) => {
    assertLocalLearningScope(connection, context);
    connection
      .prepare(
        "INSERT INTO story_positions(learner_id,target_language,story_id,paragraph) VALUES(?,?,?,?) ON CONFLICT(learner_id,target_language,story_id) DO UPDATE SET paragraph=excluded.paragraph",
      )
      .run(context.learnerId, context.targetLanguage, story.id, paragraph);
  });
}
export async function saveStoryWord(
  db: CallNinaDatabase,
  context: LearningContext,
  story: Story,
  index: number,
) {
  const word = story.vocabulary[index];
  if (!word || story.language !== context.targetLanguage)
    throw new Error("OD_STORY_REFERENCE_INVALID");
  const locale = context.explanationLanguage === "en-US" ? "en" : context.explanationLanguage;
  return withLeasedTransaction(db, (connection) => {
    assertLocalLearningScope(connection, context);
    const existing = connection
      .prepare(
        "SELECT vocabulary_id FROM vocabulary_entries WHERE lemma=? AND meaning=? AND target_language=? LIMIT 1",
      )
      .get(word.text, word.meaning[locale], story.language);
    if (existing) return false;
    const id = `vocabulary_${randomUUID().replaceAll("-", "")}`;
    const lexeme = { partOfSpeech: "other" } as const;
    const examples = [{ text: word.example, meaning: word.exampleMeaning[locale] }];
    const source = {
      kind: "curriculum" as const,
      curriculumTopicId: story.topicId,
      context: story.title[locale],
    };
    vocabularyEntrySchema.parse({
      schemaVersion: 1,
      vocabularyId: id,
      targetLanguage: story.language,
      lemma: word.text,
      meaning: word.meaning[locale],
      lexeme,
      examples,
      source,
      state: { status: "candidate", confirmation: "required" },
    });
    const now = new Date().toISOString();
    connection
      .prepare(
        "INSERT INTO vocabulary_entries(vocabulary_id,lemma,meaning,lexeme_json,examples_json,source_json,created_at,updated_at,target_language) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        word.text,
        word.meaning[locale],
        JSON.stringify(lexeme),
        JSON.stringify(examples),
        JSON.stringify(source),
        now,
        now,
        story.language,
      );
    return true;
  });
}

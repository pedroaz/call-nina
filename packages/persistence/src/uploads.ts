import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  uploadDetailSchema,
  vocabularySummarySchema,
  uploadDraftSchema,
  uploadReferenceSchema,
  vocabularyAnalysisOutputSchema,
  savedUploadItemSchema,
  uploadLearningItemSchema,
  websiteStudyPackSchema,
  vocabularyIdentity,
  type UploadLearningItem,
  type WebsiteStudyPack,
  type UploadDraft,
  type UploadReference,
  type UploadImageMetadata,
  type Language,
} from "@call-nina/contracts";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";
import { requireLocalLearningScope, scopeForLanguage } from "./learning-context.js";
import {
  contentIdentity,
  saveMaterialInTransaction,
  readMaterialRevisionInTransaction,
} from "./materials.js";

export function readUploadInTransaction(
  connection: DatabaseSync,
  reference: UploadReference,
  language?: Language,
) {
  const ref = uploadReferenceSchema.parse(reference);
  const row = connection
    .prepare(
      `SELECT r.*,u.target_language,u.created_at AS added_at,u.archived_at,i.media_type,i.byte_size FROM upload_revisions r JOIN uploads u USING(upload_id) LEFT JOIN upload_images i ON i.sha256=r.image_sha256 WHERE r.upload_id=? AND r.revision_id=?`,
    )
    .get(ref.uploadId, ref.revisionId);
  if (!row || (language && row["target_language"] !== language))
    throw new Error("OD_UPLOAD_NOT_FOUND");
  const materialRow = row["material_revision_id"]
    ? connection
        .prepare("SELECT material_id,revision_id FROM material_revisions WHERE revision_id=?")
        .get(String(row["material_revision_id"]))
    : undefined;
  const pack = connection
    .prepare("SELECT pack_json FROM upload_study_packs WHERE upload_revision_id=?")
    .get(ref.revisionId);
  return uploadDetailSchema.parse({
    ...ref,
    title: row["title"],
    format: row["format"],
    language: row["target_language"],
    createdAt: row["added_at"],
    archived: Boolean(row["archived_at"]),
    hasText: /\S/u.test(String(row["text"])),
    url: row["source_url"],
    revision: row["revision"],
    text: row["text"],
    material: materialRow
      ? readMaterialRevisionInTransaction(connection, {
          materialId: String(materialRow["material_id"]),
          revisionId: String(materialRow["revision_id"]),
        })
      : null,
    items: readItemsInTransaction(connection, ref),
    studyPack: pack ? websiteStudyPackSchema.parse(JSON.parse(String(pack["pack_json"]))) : null,
    image: row["image_sha256"]
      ? { sha256: row["image_sha256"], mediaType: row["media_type"], byteSize: row["byte_size"] }
      : null,
  });
}
export async function readUpload(
  database: CallNinaDatabase,
  reference: UploadReference,
  language?: Language,
) {
  return withLeasedConnection(database, (c) =>
    readUploadInTransaction(c, reference, language ?? requireLocalLearningScope(c).targetLanguage),
  );
}
export async function listUploads(database: CallNinaDatabase, vocabularyId?: string) {
  return withLeasedConnection(database, (c) => {
    const language = requireLocalLearningScope(c).targetLanguage;
    const rows = c
      .prepare(
        `SELECT u.upload_id,r.revision_id FROM uploads u JOIN upload_revisions r USING(upload_id) WHERE u.target_language=? AND ((? IS NULL AND u.archived_at IS NULL AND r.revision=(SELECT max(revision) FROM upload_revisions WHERE upload_id=u.upload_id)) OR (? IS NOT NULL AND EXISTS (SELECT 1 FROM upload_words w WHERE w.upload_revision_id=r.revision_id AND w.vocabulary_id=?))) ORDER BY u.created_at DESC,r.revision DESC LIMIT 500`,
      )
      .all(language, vocabularyId ?? null, vocabularyId ?? null, vocabularyId ?? null);
    return {
      rootGeneration: database.rootGeneration,
      language,
      uploads: rows.map((r) => {
        const detail = readUploadInTransaction(
          c,
          { uploadId: String(r["upload_id"]), revisionId: String(r["revision_id"]) },
          language,
        );
        return {
          uploadId: detail.uploadId,
          revisionId: detail.revisionId,
          title: detail.title,
          format: detail.format,
          language: detail.language,
          createdAt: detail.createdAt,
          archived: detail.archived,
          hasText: detail.hasText,
          url: detail.url,
        };
      }),
    };
  });
}
export async function saveUpload(
  database: CallNinaDatabase,
  value: UploadDraft,
  previous: UploadReference | undefined,
  image: UploadImageMetadata | undefined,
  expectedLanguage: Language,
  saveId: string,
  websitePack?: { pack: WebsiteStudyPack; positions: number[] },
) {
  const draft = uploadDraftSchema.parse(value);
  return withLeasedTransaction(database, (c) => {
    const language = requireLocalLearningScope(c).targetLanguage;
    if (language !== expectedLanguage) throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ draft, previous, image, language, websitePack }))
      .digest("hex");
    const replay = c
      .prepare(
        "SELECT s.*,r.upload_id FROM upload_saves s JOIN upload_revisions r ON r.revision_id=s.upload_revision_id WHERE save_id=?",
      )
      .get(saveId);
    if (replay) {
      if (replay["request_sha256"] !== requestHash) throw new Error("OD_UPLOAD_SAVE_CONFLICT");
      return readUploadInTransaction(
        c,
        { uploadId: String(replay["upload_id"]), revisionId: String(replay["upload_revision_id"]) },
        language,
      );
    }
    const prior = previous ? readUploadInTransaction(c, previous, language) : undefined;
    if (
      prior &&
      (prior.archived ||
        c
          .prepare("SELECT 1 FROM upload_revisions WHERE upload_id=? AND revision>?")
          .get(prior.uploadId, prior.revision))
    )
      throw new Error("OD_UPLOAD_REVISION_STALE");
    if (prior && prior.format !== draft.format) throw new Error("OD_UPLOAD_FORMAT_IMMUTABLE");
    const original = image ?? prior?.image;
    if (draft.format === "image" && !original) throw new Error("OD_VOCABULARY_IMAGE_INVALID");
    if (
      draft.format === "website" &&
      (!draft.url || !/^https:\/\/[^/@?#\s]+(?:[/?#][^\s]*)?$/u.test(draft.url))
    )
      throw new Error("OD_WEBSITE_IMPORT_INVALID");
    const now = new Date().toISOString(),
      uploadId = prior?.uploadId ?? contentIdentity("upload"),
      revisionId = contentIdentity("upload-revision");
    if (!prior)
      c.prepare("INSERT INTO uploads(upload_id,target_language,created_at) VALUES (?,?,?)").run(
        uploadId,
        language,
        now,
      );
    if (original)
      c.prepare("INSERT OR IGNORE INTO upload_images VALUES (?,?,?)").run(
        original.sha256,
        original.mediaType,
        original.byteSize,
      );
    const material = /\S/u.test(draft.text)
      ? saveMaterialInTransaction(
          c,
          {
            kind: "pasted-text",
            title: draft.title,
            language,
            text: draft.text,
            ...(draft.url ? { source: { url: draft.url } } : {}),
          },
          now,
          prior?.material
            ? { materialId: prior.material.materialId, revisionId: prior.material.revisionId }
            : undefined,
        )
      : null;
    c.prepare(
      "INSERT INTO upload_revisions(revision_id,upload_id,revision,format,title,text,source_url,image_sha256,material_revision_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      revisionId,
      uploadId,
      (prior?.revision ?? 0) + 1,
      draft.format,
      draft.title,
      draft.text,
      draft.url ?? null,
      original?.sha256 ?? null,
      material?.revisionId ?? null,
      now,
    );
    const ref = { uploadId, revisionId };
    if (websitePack) {
      const pack = websiteStudyPackSchema.parse(websitePack.pack);
      if (
        draft.format !== "website" ||
        draft.url !== pack.source.url ||
        websitePack.positions.some((p) => !pack.output.items[p])
      )
        throw new Error("OD_UPLOAD_ANALYSIS_STALE");
      c.prepare("INSERT INTO upload_study_packs VALUES (?,?)").run(
        revisionId,
        JSON.stringify(pack),
      );
      storeItemsInTransaction(
        c,
        ref,
        websitePack.positions.map((p) => {
          const item = pack.output.items[p];
          if (!item) throw new Error("OD_UPLOAD_ANALYSIS_STALE");
          return item;
        }),
        language,
        now,
      );
    } else if (prior) {
      // New revisions preserve selected study content, independently of vocabulary.
      if (prior.studyPack && prior.url === draft.url)
        c.prepare("INSERT INTO upload_study_packs VALUES (?,?)").run(
          revisionId,
          JSON.stringify(prior.studyPack),
        );
      if (prior.url === (draft.url ?? null)) {
        for (const item of prior.items)
          c.prepare(
            "INSERT INTO upload_items SELECT ?,upload_id,?,identity,item_json,created_at FROM upload_items WHERE item_id=? AND upload_revision_id=?",
          ).run(item.id, revisionId, item.id, prior.revisionId);
      }
    }
    c.prepare("INSERT INTO upload_saves VALUES (?,?,?)").run(saveId, requestHash, revisionId);
    return readUploadInTransaction(c, { uploadId, revisionId }, language);
  });
}
export async function archiveUpload(database: CallNinaDatabase, reference: UploadReference) {
  return withLeasedTransaction(database, (c) => {
    const upload = readUploadInTransaction(
      c,
      reference,
      requireLocalLearningScope(c).targetLanguage,
    );
    c.prepare("UPDATE uploads SET archived_at=COALESCE(archived_at,?) WHERE upload_id=?").run(
      new Date().toISOString(),
      upload.uploadId,
    );
  });
}
export async function stageUploadAnalysis(
  database: CallNinaDatabase,
  input: { analysisId: string; reference: UploadReference; language: Language; output: unknown },
) {
  const output = vocabularyAnalysisOutputSchema.parse(input.output);
  return withLeasedTransaction(database, (c) => {
    scopeForLanguage(c, input.language);
    readUploadInTransaction(c, input.reference, input.language);
    c.prepare(
      "INSERT OR IGNORE INTO upload_analyses(analysis_id,upload_revision_id,target_language,output_json,created_at) VALUES (?,?,?,?,?)",
    ).run(
      input.analysisId,
      input.reference.revisionId,
      input.language,
      JSON.stringify(output),
      new Date().toISOString(),
    );
  });
}
export async function readUploadAnalyses(database: CallNinaDatabase, reference: UploadReference) {
  return withLeasedConnection(database, (c) => {
    readUploadInTransaction(c, reference, requireLocalLearningScope(c).targetLanguage);
    return c
      .prepare(
        "SELECT analysis_id,output_json,selection_json FROM upload_analyses WHERE upload_revision_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .all(reference.revisionId)
      .filter((r) => r["selection_json"] === null)
      .map((r) => ({
        analysisId: String(r["analysis_id"]),
        output: vocabularyAnalysisOutputSchema.parse(JSON.parse(String(r["output_json"]))),
      }));
  });
}
export async function commitUploadWords(
  database: CallNinaDatabase,
  analysisId: string,
  positions: number[],
) {
  return withLeasedTransaction(database, (c) => {
    const language = requireLocalLearningScope(c).targetLanguage;
    const row = c
      .prepare("SELECT * FROM upload_analyses WHERE analysis_id=? AND target_language=?")
      .get(analysisId, language);
    if (!row) throw new Error("OD_UPLOAD_ANALYSIS_STALE");
    if (
      positions.length > 20 ||
      new Set(positions).size !== positions.length ||
      positions.some((p) => !Number.isInteger(p) || p < 0 || p > 19)
    )
      throw new Error("OD_UPLOAD_SELECTION_INVALID");
    const selection = JSON.stringify([...positions].sort((a, b) => a - b));
    if (row["selection_json"]) {
      if (row["selection_json"] !== selection) throw new Error("OD_UPLOAD_ANALYSIS_COMMITTED");
      return positions.length;
    }
    const output = vocabularyAnalysisOutputSchema.parse(JSON.parse(String(row["output_json"])));
    if (positions.some((p) => !output.words[p])) throw new Error("OD_UPLOAD_SELECTION_INVALID");
    const reference = { uploadId: "", revisionId: String(row["upload_revision_id"]) };
    const revision = c
      .prepare("SELECT upload_id FROM upload_revisions WHERE revision_id=?")
      .get(reference.revisionId);
    reference.uploadId = String(revision?.["upload_id"]);
    const upload = readUploadInTransaction(c, reference, language);
    if (upload.archived) throw new Error("OD_UPLOAD_NOT_FOUND");
    storeItemsInTransaction(
      c,
      reference,
      positions.map((p) => {
        const word = output.words[p];
        if (!word) throw new Error("OD_UPLOAD_SELECTION_INVALID");
        if (!(upload.text || output.extractedText).includes(word.excerpt))
          throw new Error("OD_UPLOAD_SELECTION_INVALID");
        const sourceText = upload.studyPack?.source.text ?? upload.text;
        const excerpt = sourceText.includes(word.excerpt) ? word.excerpt : null;
        return uploadLearningItemSchema.parse({
          lemma: word.lemma,
          meaning: word.meaning,
          lexeme: word.lexeme,
          origin: excerpt ? "page" : "suggestion",
          excerpt,
          examples: word.examples.map((example) => ({ ...example, origin: "generated" })),
        });
      }),
      language,
      new Date().toISOString(),
    );
    c.prepare("UPDATE upload_analyses SET selection_json=? WHERE analysis_id=?").run(
      selection,
      analysisId,
    );
    return positions.length;
  });
}

export async function readUploadWords(database: CallNinaDatabase, reference: UploadReference) {
  return withLeasedConnection(database, (c) => {
    readUploadInTransaction(c, reference, requireLocalLearningScope(c).targetLanguage);
    return c
      .prepare(
        `SELECT DISTINCT v.vocabulary_id,v.lemma,v.meaning,v.status,v.due_on,v.revision,v.updated_at FROM vocabulary_entries v JOIN upload_words w USING(vocabulary_id) JOIN upload_revisions r ON r.revision_id=w.upload_revision_id WHERE r.upload_id=? ORDER BY v.lemma LIMIT 500`,
      )
      .all(reference.uploadId)
      .map((r) =>
        vocabularySummarySchema.parse({
          vocabularyId: r["vocabulary_id"],
          lemma: r["lemma"],
          meaning: r["meaning"],
          status: r["status"],
          dueOn: r["due_on"],
          revision: r["revision"],
          updatedAt: r["updated_at"],
        }),
      );
  });
}

function readItemsInTransaction(c: DatabaseSync, reference: UploadReference) {
  return c
    .prepare(
      "SELECT item_id,item_json FROM upload_items WHERE upload_revision_id=? ORDER BY created_at,item_id LIMIT 500",
    )
    .all(reference.revisionId)
    .map((row) =>
      savedUploadItemSchema.parse({
        ...JSON.parse(String(row["item_json"])),
        id: row["item_id"],
      }),
    );
}
function storeItemsInTransaction(
  c: DatabaseSync,
  reference: UploadReference,
  items: UploadLearningItem[],
  language: Language,
  now: string,
) {
  const existing = Number(
    c
      .prepare("SELECT count(*) AS n FROM upload_items WHERE upload_revision_id=?")
      .get(reference.revisionId)?.["n"] ?? 0,
  );
  if (existing + items.length > 500) throw new Error("OD_UPLOAD_SELECTION_INVALID");
  for (const value of items) {
    const item = uploadLearningItemSchema.parse(value);
    const identity = vocabularyIdentity(item, language);
    c.prepare("INSERT OR IGNORE INTO upload_items VALUES (?,?,?,?,?,?)").run(
      contentIdentity("upload-item"),
      reference.uploadId,
      reference.revisionId,
      identity,
      JSON.stringify(item),
      now,
    );
  }
}

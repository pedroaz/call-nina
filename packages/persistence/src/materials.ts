import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  materialDraftSchema,
  materialReferenceSchema,
  materialRevisionSchema,
  type MaterialDraft,
  type MaterialReference,
  type MaterialRevision,
} from "@call-nina/contracts";
import { requireLocalLearningScope } from "./learning-context.js";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";

export function contentIdentity(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function readMaterialRevisionInTransaction(
  connection: DatabaseSync,
  value: MaterialReference,
): MaterialRevision {
  requireLocalLearningScope(connection);
  const ref = materialReferenceSchema.parse(value);
  const row = connection
    .prepare(
      "SELECT revision, revision_json FROM material_revisions WHERE material_id = ? AND revision_id = ?",
    )
    .get(ref.materialId, ref.revisionId);
  if (!row) throw new Error("OD_MATERIAL_NOT_FOUND");
  const material = parseStoredMaterial(row["revision_json"]);
  if (
    material.materialId !== ref.materialId ||
    material.revisionId !== ref.revisionId ||
    material.revision !== row["revision"]
  )
    throw new Error("OD_MATERIAL_INVALID");
  return material;
}

export function saveMaterialInTransaction(
  connection: DatabaseSync,
  value: MaterialDraft,
  createdAt: string,
  previous?: MaterialReference,
): MaterialRevision {
  requireLocalLearningScope(connection);
  const draft = materialDraftSchema.parse(value);
  const prior = previous ? readMaterialRevisionInTransaction(connection, previous) : undefined;
  if (
    prior &&
    connection
      .prepare("SELECT 1 FROM material_revisions WHERE material_id = ? AND revision > ?")
      .get(prior.materialId, prior.revision)
  )
    throw new Error("OD_MATERIAL_REVISION_STALE");
  const revision = materialRevisionSchema.parse({
    ...draft,
    schemaVersion: 1,
    materialId: prior?.materialId ?? contentIdentity("material"),
    revisionId: contentIdentity("material-revision"),
    revision: (prior?.revision ?? 0) + 1,
    createdAt,
  });
  connection
    .prepare(
      "INSERT INTO material_revisions(material_id, revision_id, revision, revision_json) VALUES (?, ?, ?, ?)",
    )
    .run(revision.materialId, revision.revisionId, revision.revision, JSON.stringify(revision));
  return revision;
}

export async function saveMaterial(
  database: CallNinaDatabase,
  draft: MaterialDraft,
  previous?: MaterialReference,
) {
  return withLeasedTransaction(database, (connection) =>
    saveMaterialInTransaction(connection, draft, new Date().toISOString(), previous),
  );
}
export async function readMaterialRevision(
  database: CallNinaDatabase,
  reference: MaterialReference,
) {
  return withLeasedConnection(database, (connection) =>
    readMaterialRevisionInTransaction(connection, reference),
  );
}
export async function listMaterials(database: CallNinaDatabase) {
  return withLeasedConnection(database, (connection) => {
    requireLocalLearningScope(connection);
    return connection
      .prepare(
        "SELECT material_id, revision_id FROM material_revisions m WHERE revision = (SELECT max(revision) FROM material_revisions WHERE material_id = m.material_id) ORDER BY rowid DESC LIMIT 100",
      )
      .all()
      .map((row) =>
        readMaterialRevisionInTransaction(
          connection,
          materialReferenceSchema.parse({
            materialId: row["material_id"],
            revisionId: row["revision_id"],
          }),
        ),
      );
  });
}

function parseStoredMaterial(value: unknown): MaterialRevision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value)) as unknown;
  } catch {
    throw new Error("OD_MATERIAL_INVALID");
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    parsed.schemaVersion !== 1
  )
    throw new Error("OD_MATERIAL_VERSION_UNSUPPORTED");
  const result = materialRevisionSchema.safeParse(parsed);
  if (!result.success) throw new Error("OD_MATERIAL_INVALID");
  return result.data;
}

export function linkPortableContent(
  connection: DatabaseSync,
  activityId: string,
  content: { revisionId: string; materials: readonly MaterialRevision[] },
) {
  const material = content.materials[0];
  if (!material) throw new Error("OD_CONTENT_INVALID");
  connection
    .prepare(
      "INSERT INTO activity_content_revisions(activity_id, revision_id, material_revision_id) VALUES (?, ?, ?)",
    )
    .run(activityId, content.revisionId, material.revisionId);
}

/** Validate the immutable relational links as well as the embedded portable snapshot. */
export function assertStoredContentRevision(
  connection: DatabaseSync,
  activityId: string,
  content: {
    revisionId: string;
    materials: readonly MaterialRevision[];
    goal: { courseId: string };
    language: string;
  },
) {
  const scope = requireLocalLearningScope(connection);
  const link = connection
    .prepare(
      "SELECT revision_id, material_revision_id FROM activity_content_revisions WHERE activity_id = ?",
    )
    .get(activityId);
  const material = content.materials[0];
  if (
    !link ||
    !material ||
    link["revision_id"] !== content.revisionId ||
    link["material_revision_id"] !== material.revisionId ||
    content.goal.courseId !== scope.courseId ||
    content.language !== scope.targetLanguage ||
    JSON.stringify(material) !==
      JSON.stringify(
        readMaterialRevisionInTransaction(connection, {
          materialId: material.materialId,
          revisionId: material.revisionId,
        }),
      )
  )
    throw new Error("OD_CONTENT_REVISION_INVALID");
}

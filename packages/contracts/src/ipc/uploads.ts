import {
  activityIdSchema,
  correlationIdSchema,
  dataRootGenerationSchema,
  vocabularyIdSchema,
} from "../common.js";
import { learningScopeSchema, targetLanguageSchema } from "../learning-context.js";
import {
  materialDraftSchema,
  materialReferenceSchema,
  materialRevisionSchema,
  materialSourceSchema,
} from "../material.js";
import { z } from "../schema-system.js";
import {
  uploadDetailSchema,
  uploadDraftSchema,
  uploadImageInputSchema,
  uploadReferenceSchema,
  uploadSummarySchema,
} from "../uploads.js";
import { vocabularyAnalysisOutputSchema } from "../vocabulary-learning.js";
import { vocabularySummarySchema } from "../vocabulary-library.js";
import { websiteSourceSchema } from "../website-study-pack.js";
import { request, response, text } from "./envelope.js";

export const uploadsListRequest = request(
  "uploads/list",
  z.strictObject({ vocabularyId: vocabularyIdSchema.optional() }),
);

export const uploadsReadRequest = request(
  "uploads/read",
  z.strictObject({ rootGeneration: dataRootGenerationSchema, reference: uploadReferenceSchema }),
);

export const uploadsSaveRequest = request(
  "uploads/save",
  z.strictObject({
    saveId: correlationIdSchema,
    rootGeneration: dataRootGenerationSchema,
    language: targetLanguageSchema,
    draft: uploadDraftSchema,
    previous: uploadReferenceSchema.optional(),
    websitePack: z
      .strictObject({
        operationId: correlationIdSchema,
        positions: z
          .array(z.int().min(0).max(19))
          .max(20)
          .refine((p) => new Set(p).size === p.length),
      })
      .optional(),
  }),
);

export const uploadsArchiveRequest = request(
  "uploads/archive",
  z.strictObject({ rootGeneration: dataRootGenerationSchema, reference: uploadReferenceSchema }),
);

export const uploadsImageRequest = request(
  "uploads/image",
  z.strictObject({ rootGeneration: dataRootGenerationSchema, reference: uploadReferenceSchema }),
);

export const uploadsAnalysesRequest = request(
  "uploads/analyses",
  z.strictObject({ rootGeneration: dataRootGenerationSchema, reference: uploadReferenceSchema }),
);

export const uploadsCommitRequest = request(
  "uploads/commit",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    analysisId: correlationIdSchema,
    positions: z
      .array(z.int().min(0).max(19))
      .max(20)
      .refine((values) => new Set(values).size === values.length),
  }),
);

export const materialListRequest = request(
  "material/list",
  z.strictObject({ cursor: z.int().positive().optional() }),
);

export const materialCancelImportRequest = request(
  "material/cancel-import",
  z.strictObject({ importId: correlationIdSchema }),
);

export const materialImportWebRequest = request(
  "material/import-web",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    language: targetLanguageSchema,
    url: materialSourceSchema.shape.url,
    importId: correlationIdSchema,
  }),
);

export const materialReadRequest = request(
  "material/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    reference: materialReferenceSchema,
  }),
);

export const materialDeleteRequest = request(
  "material/delete",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    learningScope: learningScopeSchema,
    reference: materialReferenceSchema,
  }),
);

export const materialSaveRequest = request(
  "material/save",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    draft: materialDraftSchema,
    previous: materialReferenceSchema.optional(),
  }),
);

export const uploadsListResponse = response(
  "uploads/list",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    language: targetLanguageSchema,
    uploads: z.array(uploadSummarySchema).max(500),
  }),
);

export const uploadsReadResponse = response(
  "uploads/read",
  z.strictObject({
    upload: uploadDetailSchema,
    words: z.array(vocabularySummarySchema).max(500),
    usage: z.strictObject({
      activityCount: z.int().nonnegative(),
      attemptCount: z.int().nonnegative(),
      activities: z
        .array(z.strictObject({ activityId: activityIdSchema, title: text(160) }))
        .max(100),
    }),
  }),
);

export const uploadsSaveResponse = response(
  "uploads/save",
  z.strictObject({ upload: uploadDetailSchema }),
);

export const uploadsArchiveResponse = response(
  "uploads/archive",
  z.strictObject({ archived: z.literal(true) }),
);

export const uploadsImageResponse = response(
  "uploads/image",
  z.strictObject({ image: uploadImageInputSchema.nullable() }),
);

export const uploadsAnalysesResponse = response(
  "uploads/analyses",
  z.strictObject({
    analyses: z
      .array(
        z.strictObject({ analysisId: correlationIdSchema, output: vocabularyAnalysisOutputSchema }),
      )
      .max(20),
  }),
);

export const uploadsCommitResponse = response(
  "uploads/commit",
  z.strictObject({ saved: z.int().nonnegative() }),
);

export const materialListResponse = response(
  "material/list",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    language: targetLanguageSchema,
    learningScope: learningScopeSchema,
    materials: z.array(materialRevisionSchema).max(100),
    nextCursor: z.int().positive().optional(),
  }),
);

export const materialReadResponse = response(
  "material/read",
  z.strictObject({
    material: materialRevisionSchema,
    usage: z.strictObject({
      activityCount: z.int().nonnegative(),
      attemptCount: z.int().nonnegative(),
      activities: z
        .array(
          z.strictObject({
            activityId: activityIdSchema,
            title: z.string().min(1).max(160),
          }),
        )
        .max(100),
    }),
  }),
);

export const materialCancelImportResponse = response(
  "material/cancel-import",
  z.strictObject({ cancelled: z.boolean() }),
);

export const materialImportWebResponse = response(
  "material/import-web",
  z.strictObject({ captureId: correlationIdSchema, source: websiteSourceSchema }),
);

export const materialDeleteResponse = response(
  "material/delete",
  z.strictObject({ deleted: z.literal(true) }),
);

export const materialSaveResponse = response(
  "material/save",
  z.strictObject({ material: materialRevisionSchema }),
);

export const uploadsRequests = [
  uploadsListRequest,
  uploadsReadRequest,
  uploadsSaveRequest,
  uploadsArchiveRequest,
  uploadsImageRequest,
  uploadsAnalysesRequest,
  uploadsCommitRequest,
  materialListRequest,
  materialImportWebRequest,
  materialCancelImportRequest,
  materialReadRequest,
  materialSaveRequest,
  materialDeleteRequest,
] as const;

export const uploadsResponses = [
  uploadsListResponse,
  uploadsReadResponse,
  uploadsSaveResponse,
  uploadsArchiveResponse,
  uploadsImageResponse,
  uploadsAnalysesResponse,
  uploadsCommitResponse,
  materialListResponse,
  materialReadResponse,
  materialImportWebResponse,
  materialCancelImportResponse,
  materialSaveResponse,
  materialDeleteResponse,
] as const;

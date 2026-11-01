import { dataRootGenerationSchema } from "../common.js";
import {
  personalDataCleanupRequestSchema,
  personalDataCleanupResultSchema,
  personalDataOverviewSchema,
} from "../personal-data.js";
import { z } from "../schema-system.js";
import { emptyPayload, request, response, text } from "./envelope.js";

export const personalDataReadRequest = request("personal-data/read", emptyPayload);

export const personalDataCleanupRequest = request(
  "personal-data/clear",
  personalDataCleanupRequestSchema,
);

export const diagnosticsReadRequest = request("diagnostics/read", emptyPayload);

export const diagnosticsExportRequest = request("diagnostics/export", emptyPayload);

export const logsClearRequest = request("logs/clear", emptyPayload);

export const personalDataReadResponse = response("personal-data/read", personalDataOverviewSchema);

export const personalDataCleanupResponse = response(
  "personal-data/clear",
  personalDataCleanupResultSchema,
);

export const diagnosticsReadResponse = response(
  "diagnostics/read",
  z.strictObject({
    dataRootGeneration: dataRootGenerationSchema,
    dataRootFormatVersion: z.literal(1),
    databaseSchemaVersion: z.int().positive().max(10_000),
    journalMode: z.literal("wal"),
    foreignKeysEnabled: z.literal(true),
    logFileCount: z.int().nonnegative().max(1_000),
    recentLogs: z.record(z.string(), z.array(z.string().min(1).max(1_000)).max(200)),
  }),
);

export const diagnosticsExportResponse = response(
  "diagnostics/export",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("cancelled") }),
    z.strictObject({ status: z.literal("exported"), displayName: text(200) }),
  ]),
);

export const logsClearResponse = response(
  "logs/clear",
  z.strictObject({ clearedFileCount: z.int().nonnegative().max(1_000) }),
);

export const diagnosticsRequests = [
  personalDataReadRequest,
  personalDataCleanupRequest,
  diagnosticsReadRequest,
  diagnosticsExportRequest,
  logsClearRequest,
] as const;

export const diagnosticsResponses = [
  personalDataReadResponse,
  personalDataCleanupResponse,
  diagnosticsReadResponse,
  diagnosticsExportResponse,
  logsClearResponse,
] as const;

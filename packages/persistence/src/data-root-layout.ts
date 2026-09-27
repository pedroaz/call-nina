import path from "node:path";

import {
  dataRootGenerationSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";

export const dataRootManifestFilename = ".open-deutsch-root.json";
export const dataRootFormatVersion = 1;

export const dataRootRelativeLayout = Object.freeze({
  manifest: dataRootManifestFilename,
  database: "open-deutsch.sqlite3",
  attachments: "attachments",
  logs: "logs",
  diagnostics: "diagnostics/redacted",
  testData: "test-data",
} as const);

export const operationalLogPolicy = Object.freeze({
  maximumFileBytes: 5 * 1024 * 1024,
  retainedFilesPerComponent: 10,
} as const);

export const dataRootManifestSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  kind: z.literal("open-deutsch-data-root"),
  dataRootFormatVersion: z.literal(dataRootFormatVersion),
  generation: dataRootGenerationSchema,
  createdAt: utcInstantSchema,
});

export type DataRootManifest = z.infer<typeof dataRootManifestSchema>;
export type DataRootLayout = ReturnType<typeof resolveDataRootLayout>;

function assertAbsoluteNormalizedRoot(root: string): string {
  if (!path.isAbsolute(root) || root.includes("\0")) {
    throw new Error("OD_DATA_ROOT_PATH_INVALID");
  }
  const normalized = path.normalize(root);
  if (normalized === path.parse(normalized).root) {
    throw new Error("OD_DATA_ROOT_PATH_TOO_BROAD");
  }
  return normalized;
}

function containedPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("OD_DATA_ROOT_LAYOUT_INVALID");
  }
  return resolved;
}

export function resolveDataRootLayout(root: string) {
  const dataRoot = assertAbsoluteNormalizedRoot(root);
  return Object.freeze({
    dataRoot,
    manifest: containedPath(dataRoot, dataRootRelativeLayout.manifest),
    database: containedPath(dataRoot, dataRootRelativeLayout.database),
    attachments: containedPath(dataRoot, dataRootRelativeLayout.attachments),
    logs: containedPath(dataRoot, dataRootRelativeLayout.logs),
    diagnostics: containedPath(dataRoot, dataRootRelativeLayout.diagnostics),
    testData: containedPath(dataRoot, dataRootRelativeLayout.testData),
  });
}

// Persisted format names are stable across the Call Nina branding change.
export function dataRootDirectories(layout: DataRootLayout) {
  return [layout.attachments, layout.logs, layout.diagnostics] as const;
}

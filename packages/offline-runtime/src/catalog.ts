import { offlineCatalogSchema, type GenerationOperationStart } from "@call-nina/contracts";
import { offlineCandidate } from "./candidate.js";
import { fail } from "./files.js";

export function offlineCatalog() {
  return offlineCatalogSchema.parse({
    routeId: "local",
    quality: "unverified",
    nativeExecution: "unverified",
    license: offlineCandidate.license,
    platform: offlineCandidate.platform,
    models: {
      models: [
        {
          id: offlineCandidate.modelId,
          displayName: offlineCandidate.label,
          isDefault: true,
          defaultReasoningEffort: "none",
          supportedReasoningEfforts: ["none"],
          inputModalities: ["text"],
          upgrade: null,
        },
      ],
      runtimeDefaultModelId: offlineCandidate.modelId,
      missingReasoningMetadata: [],
    },
    operations: ["writing-prompt", "contextual-help"],
    languages: ["en-US", "pt-BR", "es", "de"],
    contextTokens: offlineCandidate.contextTokens,
    outputTokens: offlineCandidate.outputTokens,
    maximumRequestBytes: 32 * 1024,
    admissionMemoryBytes: offlineCandidate.minimumMemoryBytes,
    admissionFreeMemoryBytes: offlineCandidate.minimumFreeMemoryBytes,
  });
}
export function offlineSelection(selection: GenerationOperationStart["modelSelection"]) {
  if (
    selection.model.selection !== "exact" ||
    selection.model.modelId !== offlineCandidate.modelId ||
    selection.effort.selection !== "exact" ||
    selection.effort.effortId !== "none"
  )
    fail("MODEL_UNAVAILABLE");
  return { modelId: offlineCandidate.modelId, effortId: "none" };
}

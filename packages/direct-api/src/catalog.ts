import {
  directApiCatalogSchema,
  directApiRouteSchema,
  generationKinds,
  type DirectApiCatalog,
  type DirectApiRoute,
  type GenerationOperationStart,
} from "@call-nina/contracts";

// Reviewed support allowlist, not an account/model discovery API. All entries
// support the same text-only learning schemas; none grant external Voice/tools.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://platform.claude.com/docs/en/models/sonnet-5-5/overview
// https://ai.google.dev/gemini-api/docs/latest-model
// Transport options follow the pinned AI SDK provider types and documentation.
const modelChoices = {
  openai: { id: "gpt-6-luna", displayName: "GPT-6 Luna", effort: "medium" },
  anthropic: { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5", effort: "high" },
  google: { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", effort: "medium" },
} as const;

export function isDirectApiRoute(value: string): value is DirectApiRoute {
  return directApiRouteSchema.safeParse(value).success;
}

export function directApiCatalog(routeId: DirectApiRoute): DirectApiCatalog {
  const choice = modelChoices[routeId];
  return directApiCatalogSchema.parse({
    routeId,
    billing: "personal-api",
    validation: "not-checked",
    operations: [...generationKinds],
    languages: ["en-US", "pt-BR", "es", "de"],
    models: {
      models: [
        {
          id: choice.id,
          displayName: choice.displayName,
          isDefault: true,
          defaultReasoningEffort: choice.effort,
          supportedReasoningEfforts: ["low", "medium", "high"],
          inputModalities: ["text"],
          upgrade: null,
        },
      ],
      runtimeDefaultModelId: choice.id,
      missingReasoningMetadata: [],
    },
  });
}

export function directApiCatalogs(): DirectApiCatalog[] {
  return directApiRouteSchema.options.map(directApiCatalog);
}

export function directApiSelection(
  route: DirectApiRoute,
  selection: GenerationOperationStart["modelSelection"],
): { modelId: string; effortId: "low" | "medium" | "high" } {
  const model = selection.model;
  const effort = selection.effort;
  if (
    model.selection !== "exact" ||
    model.modelId !== modelChoices[route].id ||
    effort.selection !== "exact" ||
    (effort.effortId !== "low" && effort.effortId !== "medium" && effort.effortId !== "high")
  )
    throw new Error("OD_DIRECT_API_MODEL_UNAVAILABLE");
  return { modelId: model.modelId, effortId: effort.effortId };
}

import {
  aiModelPreferenceSchema,
  modelCatalogSchema,
  type AiModelPreference,
  type z,
} from "@call-nina/contracts";

type RuntimeModelCatalog = z.infer<typeof modelCatalogSchema>;
type RuntimeModel = RuntimeModelCatalog["models"][number];
type SemanticEffort = "fast" | "balanced" | "deep";
export type ModelPreferenceResolution =
  | { status: "available"; effectiveModelId: string; effectiveEffortId: string }
  | { status: "unavailable" };
const exceptionalSelectionTokens = new Set([
  "extreme",
  "extrahigh",
  "highest",
  "max",
  "maximal",
  "maximum",
  "pro",
  "professional",
  "superhigh",
  "ultra",
  "veryhigh",
  "xhigh",
]);

function selectionTokens(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[._:/-]+/u)
    .filter(Boolean);
}

function isExceptionalAutomaticSelection(value: string): boolean {
  const tokens = selectionTokens(value);
  if (tokens.some((token) => exceptionalSelectionTokens.has(token))) return true;
  return tokens.some(
    (token, index) =>
      (token === "extra" || token === "super" || token === "very") && tokens[index + 1] === "high",
  );
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function catalogIsInternallyConsistent(catalog: RuntimeModelCatalog): boolean {
  const modelIds = catalog.models.map(({ id }) => id);
  if (!hasUniqueValues(modelIds) || !hasUniqueValues(catalog.missingReasoningMetadata)) {
    return false;
  }
  const modelsById = new Map(catalog.models.map((model) => [model.id, model]));
  if (catalog.missingReasoningMetadata.some((id) => !modelsById.has(id))) return false;

  const defaults = catalog.models.filter(({ isDefault }) => isDefault);
  if (
    defaults.length > 1 ||
    (defaults.length === 0) !== (catalog.runtimeDefaultModelId === null) ||
    defaults[0]?.id !== (catalog.runtimeDefaultModelId ?? undefined)
  ) {
    return false;
  }

  const computedMissingReasoningMetadata = new Set<string>();
  for (const model of catalog.models) {
    if (!hasUniqueValues(model.supportedReasoningEfforts)) return false;
    if (
      model.defaultReasoningEffort !== null &&
      !model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)
    ) {
      return false;
    }
    if (model.defaultReasoningEffort === null || model.supportedReasoningEfforts.length === 0) {
      computedMissingReasoningMetadata.add(model.id);
    }
  }
  return (
    computedMissingReasoningMetadata.size === catalog.missingReasoningMetadata.length &&
    catalog.missingReasoningMetadata.every((id) => computedMissingReasoningMetadata.has(id))
  );
}

function runtimeDefaultModel(catalog: RuntimeModelCatalog): RuntimeModel | undefined {
  const defaultModelId = catalog.runtimeDefaultModelId;
  if (
    defaultModelId === null ||
    !aiModelPreferenceSchema.shape.model.options[1].shape.modelId.safeParse(defaultModelId)
      .success ||
    isExceptionalAutomaticSelection(defaultModelId)
  ) {
    return undefined;
  }
  return catalog.models.find(({ id, isDefault }) => id === defaultModelId && isDefault);
}

function allowedAdvertisedDefaultEffort(model: RuntimeModel): string | undefined {
  const defaultEffort = model.defaultReasoningEffort;
  if (
    defaultEffort === null ||
    !Boolean(defaultEffort) ||
    !model.supportedReasoningEfforts.includes(defaultEffort) ||
    isExceptionalAutomaticSelection(defaultEffort)
  ) {
    return undefined;
  }
  return defaultEffort;
}

const ordinaryEffortRanks = new Map([
  ["none", 0],
  ["minimal", 1],
  ["low", 2],
  ["normal", 3],
  ["standard", 3],
  ["medium", 3],
  ["high", 4],
]);

function effortWithSemanticName(model: RuntimeModel, name: string): string | undefined {
  return [...model.supportedReasoningEfforts]
    .filter(
      (effort) =>
        Boolean(effort) &&
        effort.toLowerCase() === name &&
        !isExceptionalAutomaticSelection(effort),
    )
    .sort((left, right) => left.localeCompare(right))[0];
}

function deepestOrdinaryEffort(model: RuntimeModel): string | undefined {
  return [...model.supportedReasoningEfforts]
    .filter((effort) => Boolean(effort) && !isExceptionalAutomaticSelection(effort))
    .map((effort) => ({ effort, rank: ordinaryEffortRanks.get(effort.toLowerCase()) }))
    .filter((entry): entry is { effort: string; rank: number } => entry.rank !== undefined)
    .sort((left, right) => right.rank - left.rank || left.effort.localeCompare(right.effort))[0]
    ?.effort;
}

function resolveSemanticEffort(model: RuntimeModel, effort: SemanticEffort): string | undefined {
  if (effort === "fast") {
    return effortWithSemanticName(model, "low") ?? allowedAdvertisedDefaultEffort(model);
  }
  if (effort === "balanced") return allowedAdvertisedDefaultEffort(model);
  return (
    effortWithSemanticName(model, "high") ??
    deepestOrdinaryEffort(model) ??
    allowedAdvertisedDefaultEffort(model)
  );
}

// Automatic explicitly means the advertised runtime default; missing exact choices
// are unavailable. There is no workload routing or model/effort fallback.
export function resolveModelPreference(
  value: AiModelPreference,
  catalogValue: unknown,
): ModelPreferenceResolution {
  const preference = aiModelPreferenceSchema.parse(value);
  const parsed = modelCatalogSchema.safeParse(catalogValue);
  if (!parsed.success || !catalogIsInternallyConsistent(parsed.data))
    return { status: "unavailable" };
  const catalog = parsed.data;
  const modelChoice = preference.model;
  const model =
    modelChoice.mode === "exact"
      ? catalog.models.find((entry) => entry.id === modelChoice.modelId)
      : runtimeDefaultModel(catalog);
  if (!model) return { status: "unavailable" };
  const effort =
    preference.effort.mode === "exact"
      ? model.supportedReasoningEfforts.includes(preference.effort.effortId)
        ? preference.effort.effortId
        : undefined
      : resolveSemanticEffort(model, preference.effort.effort);
  return effort
    ? { status: "available", effectiveModelId: model.id, effectiveEffortId: effort }
    : { status: "unavailable" };
}

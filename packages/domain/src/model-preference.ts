import {
  providerRouteIdSchema,
  modelCatalogSchema,
  strictBoundaryObject,
  z,
} from "@call-nina/contracts";

export const modelWorkloads = ["correction", "generation", "helper", "research"] as const;
export const modelWorkloadSchema = z.enum(modelWorkloads);

export const semanticEfforts = ["fast", "balanced", "deep"] as const;
export const semanticEffortSchema = z.enum(semanticEfforts);

export const semanticEffortSemantics = {
  fast: {
    preferredEffortId: "low",
    fallback: "model-default",
    automaticMaximumOrPro: "forbidden",
  },
  balanced: {
    preferredEffortId: "model-default",
    fallback: "unavailable",
    automaticMaximumOrPro: "forbidden",
  },
  deep: {
    preferredEffortId: "high",
    fallback: "closest-supported-ordinary-then-model-default",
    automaticMaximumOrPro: "forbidden",
  },
} as const;

export const runtimeModelIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
export const runtimeEffortIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const modelChoiceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("automatic") }),
  z.strictObject({ mode: z.literal("exact"), modelId: runtimeModelIdSchema }),
]);

export const effortChoiceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("semantic"), effort: semanticEffortSchema }),
  z.strictObject({ mode: z.literal("exact"), effortId: runtimeEffortIdSchema }),
]);

export const workloadModelPreferenceSchema = z.strictObject({
  model: modelChoiceSchema,
  effort: effortChoiceSchema,
});

export const modelPreferencesSchema = strictBoundaryObject({
  routeId: providerRouteIdSchema,
  schemaVersion: z.literal(1),
  correction: workloadModelPreferenceSchema,
  generation: workloadModelPreferenceSchema,
  helper: workloadModelPreferenceSchema,
  research: workloadModelPreferenceSchema,
});

const automatic = { mode: "automatic" } as const;
const semantic = (effort: (typeof semanticEfforts)[number]) =>
  ({ mode: "semantic", effort }) as const;

export const defaultModelPreferences = {
  routeId: "codex",
  schemaVersion: 1,
  correction: { model: automatic, effort: semantic("balanced") },
  generation: { model: automatic, effort: semantic("balanced") },
  helper: { model: automatic, effort: semantic("fast") },
  research: { model: automatic, effort: semantic("deep") },
} as const satisfies z.input<typeof modelPreferencesSchema>;

const resolvedSelectionShape = {
  effectiveModelId: runtimeModelIdSchema,
  effectiveEffortId: runtimeEffortIdSchema,
  unavailableAutomaticModelId: runtimeModelIdSchema.optional(),
} as const;

export const unavailableSavedChoiceSchema = z.enum(["model", "effort", "model-and-effort"]);

export const unavailableRuntimeCapabilitySchema = z.union([
  z.strictObject({ runtimeDefaultModel: z.literal("unavailable") }),
  z.strictObject({ supportedEffort: z.literal("unavailable") }),
  z.strictObject({
    runtimeDefaultModel: z.literal("unavailable"),
    supportedEffort: z.literal("unavailable"),
  }),
]);

export const modelPreferenceResolutionSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  workload: modelWorkloadSchema,
  resolution: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("available"),
      ...resolvedSelectionShape,
    }),
    z.strictObject({
      status: z.literal("fallback"),
      ...resolvedSelectionShape,
      fallbackBasis: z.literal("runtime-default"),
      unavailableSavedChoice: unavailableSavedChoiceSchema,
      noticeKey: z.literal("modelPreferences.fallback"),
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      unavailableRuntimeCapability: unavailableRuntimeCapabilitySchema,
      noticeKey: z.literal("modelPreferences.unavailable"),
    }),
  ]),
});

export type ModelWorkload = z.infer<typeof modelWorkloadSchema>;
export type SemanticEffort = z.infer<typeof semanticEffortSchema>;
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export type EffortChoice = z.infer<typeof effortChoiceSchema>;
export type WorkloadModelPreference = z.infer<typeof workloadModelPreferenceSchema>;
export type ModelPreferences = z.infer<typeof modelPreferencesSchema>;
export type ModelPreferenceResolution = z.infer<typeof modelPreferenceResolutionSchema>;

type RuntimeModelCatalog = z.infer<typeof modelCatalogSchema>;
type RuntimeModel = RuntimeModelCatalog["models"][number];
type UnavailableRuntimeCapability = z.infer<typeof unavailableRuntimeCapabilitySchema>;
type UnavailableSavedChoice = z.infer<typeof unavailableSavedChoiceSchema>;

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

function unavailable(
  workload: ModelWorkload,
  unavailableRuntimeCapability: UnavailableRuntimeCapability,
): ModelPreferenceResolution {
  return modelPreferenceResolutionSchema.parse({
    schemaVersion: 1,
    workload,
    resolution: {
      status: "unavailable",
      unavailableRuntimeCapability,
      noticeKey: "modelPreferences.unavailable",
    },
  });
}

function resolved(
  workload: ModelWorkload,
  effectiveModelId: string,
  effectiveEffortId: string,
  unavailableChoices: ReadonlySet<"model" | "effort">,
  unavailableAutomaticModelId?: string,
): ModelPreferenceResolution {
  const unavailableSavedChoice: UnavailableSavedChoice | undefined =
    unavailableChoices.size === 0
      ? undefined
      : unavailableChoices.size === 2
        ? "model-and-effort"
        : unavailableChoices.has("model")
          ? "model"
          : "effort";
  return modelPreferenceResolutionSchema.parse({
    schemaVersion: 1,
    workload,
    resolution:
      unavailableSavedChoice === undefined
        ? {
            status: "available",
            effectiveModelId,
            effectiveEffortId,
            ...(unavailableAutomaticModelId ? { unavailableAutomaticModelId } : {}),
          }
        : {
            status: "fallback",
            effectiveModelId,
            effectiveEffortId,
            fallbackBasis: "runtime-default",
            ...(unavailableAutomaticModelId ? { unavailableAutomaticModelId } : {}),
            unavailableSavedChoice,
            noticeKey: "modelPreferences.fallback",
          },
  });
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
    !runtimeModelIdSchema.safeParse(defaultModelId).success ||
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
    !runtimeEffortIdSchema.safeParse(defaultEffort).success ||
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
        runtimeEffortIdSchema.safeParse(effort).success &&
        effort.toLowerCase() === name &&
        !isExceptionalAutomaticSelection(effort),
    )
    .sort((left, right) => left.localeCompare(right))[0];
}

function deepestOrdinaryEffort(model: RuntimeModel): string | undefined {
  return [...model.supportedReasoningEfforts]
    .filter(
      (effort) =>
        runtimeEffortIdSchema.safeParse(effort).success && !isExceptionalAutomaticSelection(effort),
    )
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

export function resolveModelPreference(
  workloadValue: ModelWorkload,
  preferenceValue: WorkloadModelPreference,
  catalogValue: unknown,
): ModelPreferenceResolution {
  const workload = modelWorkloadSchema.parse(workloadValue);
  const preference = workloadModelPreferenceSchema.parse(preferenceValue);
  const parsedCatalog = modelCatalogSchema.safeParse(catalogValue);
  if (!parsedCatalog.success || !catalogIsInternallyConsistent(parsedCatalog.data)) {
    return unavailable(workload, {
      runtimeDefaultModel: "unavailable",
      supportedEffort: "unavailable",
    });
  }
  const catalog = parsedCatalog.data;
  const fallbackModel = runtimeDefaultModel(catalog);
  const unavailableChoices = new Set<"model" | "effort">();

  let effectiveModel: RuntimeModel | undefined;
  let unavailableAutomaticModelId: string | undefined;
  if (preference.model.mode === "exact") {
    const savedModelId = preference.model.modelId;
    effectiveModel = catalog.models.find(({ id }) => id === savedModelId);
    if (!effectiveModel) {
      unavailableChoices.add("model");
      effectiveModel = fallbackModel;
    }
  } else {
    const preferredId = workload === "helper" ? "gpt-6-luna" : "gpt-6-sol";
    const preferred = catalog.models.find(({ id }) => id === preferredId);
    const usable =
      preferred &&
      (preference.effort.mode === "semantic"
        ? resolveSemanticEffort(preferred, preference.effort.effort)
        : preferred.supportedReasoningEfforts.includes(preference.effort.effortId) ||
          allowedAdvertisedDefaultEffort(preferred));
    effectiveModel = usable ? preferred : fallbackModel;
    if (!usable) unavailableAutomaticModelId = preferredId;
  }
  if (!effectiveModel) {
    return unavailable(workload, { runtimeDefaultModel: "unavailable" });
  }

  let effectiveEffort: string | undefined;
  if (preference.effort.mode === "exact") {
    if (effectiveModel.supportedReasoningEfforts.includes(preference.effort.effortId)) {
      effectiveEffort = preference.effort.effortId;
    } else {
      unavailableChoices.add("effort");
      effectiveEffort = allowedAdvertisedDefaultEffort(effectiveModel);
    }
  } else {
    effectiveEffort = resolveSemanticEffort(effectiveModel, preference.effort.effort);
  }
  if (!effectiveEffort) {
    return unavailable(workload, { supportedEffort: "unavailable" });
  }

  return resolved(
    workload,
    effectiveModel.id,
    effectiveEffort,
    unavailableChoices,
    unavailableAutomaticModelId,
  );
}

import { modelCatalogSchema, type z } from "@call-nina/contracts";

import {
  AppServerProjectionError,
  isJsonObject,
  optionalNonblankString,
  requiredNonblankString,
  type AppServerRequester,
} from "./projections.js";

export type ModelCatalog = z.output<typeof modelCatalogSchema>;

type ProjectedModel = ModelCatalog["models"][number];
type PendingUpgrade = Readonly<{ targetModelId: string; description: string | null }> | null;

const callNinaReasoningEfforts = ["low", "medium", "high", "xhigh"] as const;

function projectEfforts(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  }
  const entries: unknown[] = value;
  const efforts = entries.map((entry) => {
    if (!isJsonObject(entry))
      throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
    return requiredNonblankString(entry["reasoningEffort"], 100);
  });
  if (new Set(efforts).size !== efforts.length) {
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  }
  return efforts;
}

function projectModalities(value: unknown): ("text" | "image")[] {
  if (value === undefined) return ["text", "image"];
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  }
  const entries: unknown[] = value;
  const modalities = entries.map((entry) => requiredNonblankString(entry, 100));
  if (new Set(modalities).size !== modalities.length) {
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  }
  return modalities.filter(
    (entry): entry is "text" | "image" => entry === "text" || entry === "image",
  );
}

function projectUpgrade(entry: Record<string, unknown>): PendingUpgrade {
  const legacyTarget = optionalNonblankString(entry["upgrade"]);
  const info = entry["upgradeInfo"];
  if (info === undefined || info === null) {
    return legacyTarget === null ? null : { targetModelId: legacyTarget, description: null };
  }
  if (!isJsonObject(info)) throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  const targetModelId = requiredNonblankString(info["model"]);
  if (legacyTarget !== null && legacyTarget !== targetModelId) {
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  }
  return {
    targetModelId,
    description: optionalNonblankString(info["upgradeCopy"], 500),
  };
}

export function projectModelCatalog(value: unknown): ModelCatalog {
  if (!isJsonObject(value) || !Array.isArray(value["data"]) || value["data"].length > 200) {
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  }
  const pending: { model: Omit<ProjectedModel, "upgrade">; upgrade: PendingUpgrade }[] = [];
  const seen = new Set<string>();
  for (const entry of value["data"]) {
    if (!isJsonObject(entry)) {
      throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
    }
    if (entry["hidden"] !== undefined && typeof entry["hidden"] !== "boolean") {
      throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
    }
    if (entry["hidden"] === true) continue;
    if (entry["isDefault"] !== undefined && typeof entry["isDefault"] !== "boolean") {
      throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
    }
    const id = optionalNonblankString(entry["id"]) ?? requiredNonblankString(entry["model"]);
    if (seen.has(id)) throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
    seen.add(id);
    const supportedReasoningEfforts = projectEfforts(entry["supportedReasoningEfforts"]);
    const defaultReasoningEffort = optionalNonblankString(entry["defaultReasoningEffort"], 100);
    if (
      defaultReasoningEffort !== null &&
      supportedReasoningEfforts.length > 0 &&
      !supportedReasoningEfforts.includes(defaultReasoningEffort)
    ) {
      throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
    }
    pending.push({
      model: {
        id,
        displayName: optionalNonblankString(entry["displayName"], 200) ?? id,
        isDefault: entry["isDefault"] === true,
        defaultReasoningEffort,
        supportedReasoningEfforts,
        inputModalities: projectModalities(entry["inputModalities"]),
      },
      upgrade: projectUpgrade(entry),
    });
  }
  const defaults = pending.filter(({ model }) => model.isDefault);
  if (defaults.length > 1) throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
  const selectable = pending.flatMap((entry) => {
    if (!entry.model.inputModalities.includes("text")) return [];
    const supportedReasoningEfforts = callNinaReasoningEfforts.filter((effort) =>
      entry.model.supportedReasoningEfforts.includes(effort),
    );
    const defaultReasoningEffort =
      entry.model.defaultReasoningEffort !== null &&
      supportedReasoningEfforts.includes(
        entry.model.defaultReasoningEffort as (typeof callNinaReasoningEfforts)[number],
      )
        ? entry.model.defaultReasoningEffort
        : null;
    return [
      {
        ...entry,
        model: {
          ...entry.model,
          defaultReasoningEffort,
          supportedReasoningEfforts,
        },
      },
    ];
  });
  const preferredOrder = ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"];
  const rank = (id: string) => {
    const index = preferredOrder.indexOf(id);
    return index < 0 ? preferredOrder.length : index;
  };
  selectable.sort((left, right) => rank(left.model.id) - rank(right.model.id));
  const selectableIds = new Set(selectable.map(({ model }) => model.id));
  const displayNames = new Map(selectable.map(({ model }) => [model.id, model.displayName]));
  return modelCatalogSchema.parse({
    models: selectable.map(({ model, upgrade }) => ({
      ...model,
      upgrade:
        upgrade === null || !selectableIds.has(upgrade.targetModelId)
          ? null
          : {
              ...upgrade,
              displayName: displayNames.get(upgrade.targetModelId) ?? null,
            },
    })),
    runtimeDefaultModelId:
      defaults[0] && selectableIds.has(defaults[0].model.id) ? defaults[0].model.id : null,
    missingReasoningMetadata: selectable
      .filter(
        ({ model }) =>
          model.defaultReasoningEffort === null || model.supportedReasoningEfforts.length === 0,
      )
      .map(({ model }) => model.id),
  });
}

export type ModelCatalogClientOptions = Readonly<{
  requester: AppServerRequester;
  maximumPages?: number;
  pageSize?: number;
  requestTimeoutMilliseconds?: number;
  onCatalogChanged?: (catalog: ModelCatalog) => void;
}>;

export class ModelCatalogClient {
  readonly #options: ModelCatalogClientOptions;

  constructor(options: ModelCatalogClientOptions) {
    this.#options = options;
  }

  async refresh(): Promise<ModelCatalog> {
    const data: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    const maximumPages = this.#options.maximumPages ?? 20;
    const pageSize = this.#options.pageSize ?? 100;
    if (
      !Number.isInteger(maximumPages) ||
      maximumPages < 1 ||
      maximumPages > 20 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_PAGINATION_INVALID");
    }
    for (let page = 0; page < maximumPages; page += 1) {
      const result = await this.#options.requester.request(
        "model/list",
        {
          limit: pageSize,
          includeHidden: false,
          ...(cursor === null ? {} : { cursor }),
        },
        { timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 20_000 },
      );
      if (!isJsonObject(result) || !Array.isArray(result["data"])) {
        throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
      }
      const pageData: unknown[] = result["data"];
      data.push(...pageData);
      if (data.length > 200) throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_INVALID");
      const nextCursor = optionalNonblankString(result["nextCursor"]);
      if (nextCursor === null) {
        const catalog = projectModelCatalog({ data });
        this.#options.onCatalogChanged?.(catalog);
        return catalog;
      }
      if (cursors.has(nextCursor)) {
        throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_PAGINATION_INVALID");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new AppServerProjectionError("APP_SERVER_MODEL_CATALOG_PAGINATION_LIMIT");
  }

  async handleNotification(method: string): Promise<boolean> {
    if (method !== "account/updated") return false;
    await this.refresh();
    return true;
  }
}

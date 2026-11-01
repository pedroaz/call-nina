import { modelCatalogSchema, z } from "@call-nina/contracts";
import { ChatgptError, apiOrigin, jsonRequest } from "./http.js";

type Catalog = ReturnType<typeof modelCatalogSchema.parse>;
interface CatalogSession {
  selectedRegistration: () => Promise<string | null>;
  token: (signal: AbortSignal, id?: string) => Promise<string>;
  closed: () => boolean;
}
export class ChatgptCatalog {
  readonly #session: CatalogSession;
  #catalog: { registrationId: string; value: Catalog; expires: number } | undefined;
  constructor(session: CatalogSession) {
    this.#session = session;
  }
  reset() {
    this.#catalog = undefined;
  }
  async models(signal: AbortSignal = AbortSignal.timeout(20000)): Promise<Catalog> {
    const id = await this.#session.selectedRegistration();
    if (!id) throw new ChatgptError("authentication", "OD_CHATGPT_SIGN_IN_REQUIRED");
    if (this.#catalog?.registrationId === id && this.#catalog.expires > Date.now())
      return structuredClone(this.#catalog.value);
    const token = await this.#session.token(signal, id);
    const response = await jsonRequest(`${apiOrigin}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    const modelSchema = z.object({
      slug: z.string().min(1).max(200),
      display_name: z.string().min(1).max(200),
      visibility: z.string(),
      input_modalities: z.array(z.string()).optional(),
      default_reasoning_level: z.string().nullable().optional(),
      supported_reasoning_levels: z
        .array(z.object({ effort: z.string().min(1).max(100) }))
        .max(20)
        .optional(),
    });
    const listed = z
      .object({ models: z.array(modelSchema).max(500) })
      .parse(response)
      .models.filter(
        (entry) =>
          entry.visibility === "list" && (entry.input_modalities ?? ["text"]).includes("text"),
      );
    const models = listed.map((entry, index) => ({
      id: entry.slug,
      displayName: entry.display_name,
      isDefault: index === 0,
      defaultReasoningEffort: entry.default_reasoning_level ?? null,
      supportedReasoningEfforts: (entry.supported_reasoning_levels ?? []).map(
        (level) => level.effort,
      ),
      inputModalities: (entry.input_modalities ?? ["text"]).filter(
        (value) => value === "text" || value === "image",
      ),
      upgrade: null,
    }));
    const value = modelCatalogSchema.parse({
      models,
      runtimeDefaultModelId: models[0]?.id ?? null,
      missingReasoningMetadata: models
        .filter((entry) => !entry.defaultReasoningEffort || !entry.supportedReasoningEfforts.length)
        .map((entry) => entry.id),
    });
    if ((await this.#session.selectedRegistration()) !== id || this.#session.closed())
      throw new ChatgptError("authentication", "OD_CHATGPT_ACCOUNT_CHANGED");
    this.#catalog = { registrationId: id, value, expires: Date.now() + 60000 };
    return value;
  }
}

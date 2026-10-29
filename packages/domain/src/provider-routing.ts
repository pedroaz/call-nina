import {
  aiProviderOrder,
  generationKindSchema,
  type AiConnection,
  type AiAction,
  type AiRouting,
  type aiConnectionsViewSchema,
  type z,
} from "@call-nina/contracts";
import { resolveModelPreference } from "./model-preference.js";

type View = z.infer<typeof aiConnectionsViewSchema>;
export function providerSupports(
  view: View,
  connection: AiConnection,
  capability: "text" | "image",
  action?: AiAction,
) {
  const available = view.availability.find((entry) => entry.connectionId === connection.id);
  if (!available?.models) return false;
  const resolution = resolveModelPreference(connection.preference, available.models);
  if (resolution.status !== "available") return false;
  const model = available.models.models.find((entry) => entry.id === resolution.effectiveModelId);
  if (!model?.inputModalities.includes("text")) return false;
  if (
    capability === "image" &&
    (connection.routeId !== "chatgpt" || !model.inputModalities.includes("image"))
  )
    return false;
  return action
    ? available.operations.includes(action === "translation" ? "contextual-help" : action)
    : available.operations.length > 0;
}
export function recommendedRouting(view: View): AiRouting {
  const ready = aiProviderOrder.flatMap((route) =>
    view.settings.connections.filter((connection) => {
      const status = view.availability.find(
        (entry) => entry.connectionId === connection.id,
      )?.status;
      return connection.routeId === route && (status === "available" || status === "configured");
    }),
  );
  const all = [...generationKindSchema.options, "translation"] as const;
  const complete = ready.find((connection) =>
    all.every((action) => providerSupports(view, connection, "text", action)),
  );
  const text = complete;
  const actions: AiRouting["actions"] = {};
  for (const action of all) {
    if (text && providerSupports(view, text, "text", action)) continue;
    const match = ready.find((connection) => providerSupports(view, connection, "text", action));
    if (match) actions[action] = match.routeId;
  }
  return {
    liveConversation: view.settings.routing.liveConversation,
    text: text?.routeId ?? null,
    image:
      ready.find((connection) => providerSupports(view, connection, "image", "vocabulary-analysis"))
        ?.routeId ?? null,
    actions,
  };
}

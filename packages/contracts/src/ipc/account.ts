import { mobileSyncResultSchema } from "../mobile-sync.js";
import {
  ninaAccountStateSchema,
  ninaAccountUpdateSchema,
  ninaLoginCredentialsSchema,
  ninaLoginDiagnosticSchema,
} from "../nina-account.js";
import { z } from "../schema-system.js";
import { emptyPayload, request, response } from "./envelope.js";

export const accountRequests = [
  request("nina-account/credentials/read", emptyPayload),
  request("nina-account/credentials/save", ninaLoginCredentialsSchema),
  request("nina-account/diagnostic", ninaLoginDiagnosticSchema),
  request("mobile-sync/publish", emptyPayload),
  request("mobile-sync/read", emptyPayload),
  request("nina-account/read", emptyPayload),
  request("nina-account/update", ninaAccountUpdateSchema),
] as const;

export const accountResponses = [
  response(
    "nina-account/credentials/read",
    z.strictObject({ available: z.boolean(), credentials: ninaLoginCredentialsSchema.nullable() }),
  ),
  response("nina-account/credentials/save", z.strictObject({ saved: z.boolean() })),
  response("nina-account/diagnostic", z.strictObject({ recorded: z.boolean() })),
  response("mobile-sync/publish", mobileSyncResultSchema),
  response("mobile-sync/read", mobileSyncResultSchema),
  response("nina-account/read", ninaAccountStateSchema),
  response("nina-account/update", ninaAccountStateSchema),
] as const;

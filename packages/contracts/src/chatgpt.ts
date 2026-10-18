import { accountStateSchema } from "./app-server-state.js";
import { z } from "./schema-system.js";

export const chatgptRegistrationIdSchema = z.string().regex(/^oaiapp_[A-Za-z0-9_-]{1,200}$/u);
export const chatgptAccountsSchema = z.strictObject({
  state: accountStateSchema,
  selectedId: chatgptRegistrationIdSchema.nullable(),
  registrations: z
    .array(
      z.strictObject({
        id: chatgptRegistrationIdSchema,
        label: z.string().min(1).max(320),
      }),
    )
    .max(20),
  remoteRevocationPending: z.boolean(),
});

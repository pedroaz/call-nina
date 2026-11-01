import { languageSchema } from "../learning-context.js";
import { analyticsScreenSchema, analyticsStateSchema } from "../product-feedback.js";
import { z } from "../schema-system.js";
import { emptyPayload, request, response } from "./envelope.js";

export const productFeedbackRequests = [
  request("feedback/open", z.strictObject({ locale: languageSchema })),
  request("analytics/read", emptyPayload),
  request("analytics/consent", z.strictObject({ enabled: z.boolean() })),
  request("analytics/screen", z.strictObject({ screen: analyticsScreenSchema.nullable() })),
] as const;
export const productFeedbackResponses = [
  response("feedback/open", z.strictObject({ opened: z.boolean() })),
  response("analytics/read", analyticsStateSchema),
  response("analytics/consent", analyticsStateSchema),
  response("analytics/screen", z.strictObject({ accepted: z.boolean() })),
] as const;

import { z } from "./schema-system.js";

export const analyticsConsentSchema = z.enum(["unknown", "enabled", "disabled"]);
export const analyticsScreenSchema = z.enum([
  "nina",
  "practice",
  "writing",
  "vocabulary",
  "stories",
  "community",
  "mobile",
  "learningPath",
  "personalData",
  "settings",
]);
export const analyticsStateSchema = z.strictObject({
  available: z.boolean(),
  consent: analyticsConsentSchema,
});
export type AnalyticsConsent = z.infer<typeof analyticsConsentSchema>;
export type AnalyticsScreen = z.infer<typeof analyticsScreenSchema>;
export type AnalyticsState = z.infer<typeof analyticsStateSchema>;

import { correlationIdSchema, runIdSchema, sessionIdSchema, utcInstantSchema } from "./common.js";
import { boundaryUnion, strictBoundaryObject, z } from "./schema-system.js";

export const errorDefinitions = {
  "exercise-context-missing": {
    code: "OD_EXERCISE_CONTEXT_MISSING",
    messageKey: "errors.exerciseContextMissing",
  },
  validation: { code: "OD_VALIDATION_FAILED", messageKey: "errors.validation" },
  "not-found": { code: "OD_NOT_FOUND", messageKey: "errors.notFound" },
  conflict: { code: "OD_CONFLICT", messageKey: "errors.conflict" },
  "stale-data-root": { code: "OD_DATA_ROOT_STALE", messageKey: "errors.staleDataRoot" },
  "data-root-busy": { code: "OD_DATA_ROOT_BUSY", messageKey: "errors.dataRootBusy" },
  database: { code: "OD_DATABASE_FAILED", messageKey: "errors.database" },
  "app-server": { code: "OD_APP_SERVER_FAILED", messageKey: "errors.appServer" },
  "ai-policy": { code: "OD_APP_SERVER_POLICY_VIOLATION", messageKey: "errors.aiPolicy" },
  "ai-timeout": {
    code: "OD_APP_SERVER_OPERATION_TIMEOUT",
    messageKey: "errors.aiTimeout",
  },
  "model-unavailable": {
    code: "OD_APP_SERVER_MODEL_UNAVAILABLE",
    messageKey: "errors.modelUnavailable",
  },
  authentication: { code: "OD_AUTHENTICATION_REQUIRED", messageKey: "errors.authentication" },
  "unsupported-codex-version": {
    code: "OD_CODEX_VERSION_UNSUPPORTED",
    messageKey: "errors.unsupportedCodexVersion",
  },
  "rate-limit": { code: "OD_RATE_LIMITED", messageKey: "errors.rateLimit" },
  cancellation: { code: "OD_CANCELLED", messageKey: "errors.cancellation" },
  "model-output": { code: "OD_MODEL_OUTPUT_INVALID", messageKey: "errors.modelOutput" },
  mcp: { code: "OD_MCP_FAILED", messageKey: "errors.mcp" },
  handoff: { code: "OD_HANDOFF_FAILED", messageKey: "errors.handoff" },
  "unsupported-operation": {
    code: "OD_OPERATION_UNSUPPORTED",
    messageKey: "errors.unsupportedOperation",
  },
} as const;

export type ErrorKind = keyof typeof errorDefinitions;
export type ErrorCode = (typeof errorDefinitions)[ErrorKind]["code"];
export type ErrorMessageKey = (typeof errorDefinitions)[ErrorKind]["messageKey"];

const errorKinds = Object.keys(errorDefinitions) as [ErrorKind, ...ErrorKind[]];
const errorCodes = Object.values(errorDefinitions).map(({ code }) => code) as [
  ErrorCode,
  ...ErrorCode[],
];
const errorMessageKeys = Object.values(errorDefinitions).map(({ messageKey }) => messageKey) as [
  ErrorMessageKey,
  ...ErrorMessageKey[],
];

export const errorKindSchema = z.enum(errorKinds);
export const errorCodeSchema = z.enum(errorCodes);
export const errorMessageKeySchema = z.enum(errorMessageKeys);

export const logReferenceSchema = strictBoundaryObject({
  code: errorCodeSchema,
  correlationId: correlationIdSchema,
  runId: runIdSchema.optional(),
  sessionId: sessionIdSchema.optional(),
  occurredAt: utcInstantSchema,
});

const errorVariants = errorKinds.map((kind) => {
  const definition = errorDefinitions[kind];
  return strictBoundaryObject({
    schemaVersion: z.literal(1),
    kind: z.literal(kind),
    code: z.literal(definition.code),
    messageKey: z.literal(definition.messageKey),
    reference: z.strictObject({
      code: z.literal(definition.code),
      correlationId: correlationIdSchema,
      runId: runIdSchema.optional(),
      sessionId: sessionIdSchema.optional(),
      occurredAt: utcInstantSchema,
    }),
  });
});

export const callNinaErrorSchema = boundaryUnion(
  errorVariants as unknown as [
    (typeof errorVariants)[number],
    (typeof errorVariants)[number],
    ...(typeof errorVariants)[number][],
  ],
);

export type LogReference = z.infer<typeof logReferenceSchema>;
export type CallNinaError = z.infer<typeof callNinaErrorSchema>;

export const safeErrorMessages = {
  en: {
    "exercise-context-missing":
      "This activity did not save its original teaching settings. Create fresh practice for new AI feedback or teaching. Your saved activity, answers and feedback are unchanged.",
    validation:
      "Some information is invalid or incomplete. Check the required fields and try again.",
    "not-found": "This item is no longer available. Reopen the list and select another item.",
    conflict:
      "This item changed before the action finished. Reopen it to load the current version, then try again.",
    "stale-data-root":
      "The selected learning folder changed. Reopen this view before trying again.",
    "data-root-busy": "Wait for the active AI work to finish or cancel it before changing folders.",
    database:
      "Call Nina could not read or save local learning data. Check that the selected folder is available and writable in Settings/Account, then retry.",
    "app-server":
      "The AI action could not finish. Retry once. If it fails again, check Codex in Settings/Account and report the diagnostic reference.",
    authentication:
      "Codex needs you to sign in. Open Settings/Account, connect your Codex account, then retry.",
    "unsupported-codex-version":
      "Call Nina could not use this Codex installation. Check its status in Settings/Account and update or reinstall Codex if needed.",
    "rate-limit":
      "Your Codex usage limit was reached. Check Settings/Account for the reset time and try again after it resets.",
    cancellation: "The operation was cancelled.",
    "model-output":
      "Codex returned an incomplete or unusable result. Try again; if it keeps happening, try another model or report the diagnostic reference.",
    mcp: "The Codex integration could not complete this action. Check its status in Settings/Account and install or refresh the integration if needed.",
    handoff:
      "Call Nina could not open the related activity. Check the Codex integration in Settings/Account, then try again.",
    "unsupported-operation":
      "This action is unavailable in the current setup. Check Settings/Account for supported options.",
    "ai-policy":
      "Call Nina stopped this AI action because it encountered an operation outside the allowed learning workflow. Retry once. If it happens again, report the diagnostic reference.",
    "ai-timeout":
      "Codex did not finish within the time limit. Try again with a shorter request or a smaller activity.",
    "model-unavailable":
      "The selected model or reasoning setting is unavailable. Choose Automatic or another available option in the model selector, then retry.",
  },
  de: {
    "exercise-context-missing":
      "Für diese Aktivität wurden die ursprünglichen Lerneinstellungen nicht gespeichert. Erstelle eine neue Übung für neues KI-Feedback oder weitere KI-Begleitung. Deine gespeicherte Aktivität, Antworten und Rückmeldungen bleiben unverändert.",
    validation:
      "Einige Angaben sind ungültig oder unvollständig. Prüfe die Pflichtfelder und versuche es erneut.",
    "not-found":
      "Dieses Element ist nicht mehr verfügbar. Öffne die Liste erneut und wähle ein anderes Element.",
    conflict:
      "Dieses Element wurde vor Abschluss geändert. Öffne es erneut, um die aktuelle Version zu laden, und versuche es noch einmal.",
    "stale-data-root":
      "Der ausgewählte Lernordner wurde geändert. Öffne diese Ansicht erneut, bevor du es noch einmal versuchst.",
    "data-root-busy":
      "Beende oder stoppe zuerst die laufende KI-Aktion, bevor du den Ordner wechselst.",
    database:
      "Call Nina konnte lokale Lerndaten nicht lesen oder speichern. Prüfe unter Einstellungen/Konto, ob der gewählte Ordner verfügbar und beschreibbar ist, und versuche es erneut.",
    "app-server":
      "Die KI-Aktion konnte nicht abgeschlossen werden. Versuche es einmal erneut. Prüfe bei erneutem Fehler Codex unter Einstellungen/Konto und melde die Diagnosereferenz.",
    authentication:
      "Du musst dich bei Codex anmelden. Verbinde dein Codex-Konto unter Einstellungen/Konto und versuche es erneut.",
    "unsupported-codex-version":
      "Call Nina konnte diese Codex-Installation nicht verwenden. Prüfe den Status unter Einstellungen/Konto und aktualisiere oder installiere Codex bei Bedarf neu.",
    "rate-limit":
      "Dein Codex-Nutzungslimit wurde erreicht. Prüfe unter Einstellungen/Konto den Zeitpunkt der Zurücksetzung und versuche es danach erneut.",
    cancellation: "Der Vorgang wurde abgebrochen.",
    "model-output":
      "Codex hat ein unvollständiges oder unbrauchbares Ergebnis geliefert. Versuche es erneut. Wähle bei wiederholtem Fehler ein anderes Modell oder melde die Diagnosereferenz.",
    mcp: "Die Codex-Integration konnte diese Aktion nicht abschließen. Prüfe den Status unter Einstellungen/Konto und installiere oder aktualisiere die Integration bei Bedarf.",
    handoff:
      "Call Nina konnte die zugehörige Aktivität nicht öffnen. Prüfe die Codex-Integration unter Einstellungen/Konto und versuche es erneut.",
    "unsupported-operation":
      "Diese Aktion ist in der aktuellen Einrichtung nicht verfügbar. Prüfe die verfügbaren Optionen unter Einstellungen/Konto.",
    "ai-policy":
      "Call Nina hat diese KI-Aktion gestoppt, weil ein Vorgang außerhalb des erlaubten Lernablaufs auftrat. Versuche es einmal erneut. Melde bei erneutem Auftreten die Diagnosereferenz.",
    "ai-timeout":
      "Codex wurde innerhalb des Zeitlimits nicht fertig. Versuche es mit einer kürzeren Anfrage oder einer kleineren Übung erneut.",
    "model-unavailable":
      "Das gewählte Modell oder die Denkeinstellung ist nicht verfügbar. Wähle in der Modellauswahl Automatisch oder eine andere verfügbare Option und versuche es erneut.",
  },
} as const satisfies Record<"en" | "de", Record<ErrorKind, string>>;

export type ErrorLocale = keyof typeof safeErrorMessages;

export function localizedErrorMessage(kind: ErrorKind, locale: ErrorLocale): string {
  return safeErrorMessages[locale][kind];
}

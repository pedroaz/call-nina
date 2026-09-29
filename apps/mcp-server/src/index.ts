import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  activityIdSchema,
  correlationIdSchema,
  activityCreateInputSchema,
  activityCreateResultSchema,
  attemptFeedbackSaveInputSchema,
  attemptFeedbackSaveResultSchema,
  listeningResultSaveInputSchema,
  listeningResultSaveResultSchema,
  curriculumCoverageReadInputSchema,
  curriculumCoverageReadResultSchema,
  errorDefinitions,
  learnerContextReadInputSchema,
  learnerContextReadResultSchema,
  mcpToolContracts,
  callNinaErrorSchema,
  practiceContextReadInputSchema,
  practiceContextReadResultSchema,
  preparedVoiceActivityReadInputSchema,
  preparedVoiceActivityReadResultSchema,
  voiceSummarySaveInputSchema,
  voiceSummarySaveResultSchema,
  type LearningContext,
  type ErrorKind,
  utcInstantSchema,
} from "@call-nina/contracts";
import {
  resolveCourseReference,
  recommendCourseActivity,
  validateCourseEvidence,
  selectNextCurriculumGap,
  voiceSummarySchema,
} from "@call-nina/domain";
import {
  readLearningCourse,
  assertCurrentDataRootLease,
  CallNinaRepository,
  appendOperationalLog,
  openCallNinaDatabase,
  readBootstrapPointer,
  resolveDataRootLayout,
  type CallNinaDatabase,
} from "@call-nina/persistence";

import { readCurriculumInventory } from "./curriculum.js";

export const productionServerIdentity = Object.freeze({
  name: "call-nina",
  version: "0.2.0",
});
const thisFile = fileURLToPath(import.meta.url);

type Runtime = Readonly<{
  bootstrapFile: string;
  dataRoot: string;
  rootGeneration: number;
  sessionId: string;
  database: CallNinaDatabase;
  repository: CallNinaRepository;
}>;

function deterministicId(
  prefix: "activity" | "attempt" | "model-request" | "plan" | "voice-session",
  key: string,
) {
  return `${prefix}_${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32)}`;
}

function now() {
  return new Date().toISOString();
}

function safeError(kind: ErrorKind) {
  const definition = errorDefinitions[kind];
  const correlationId = `correlation_${randomUUID().replaceAll("-", "")}`;
  const occurredAt = now();
  return callNinaErrorSchema.parse({
    schemaVersion: 1,
    kind,
    code: definition.code,
    messageKey: definition.messageKey,
    reference: { code: definition.code, correlationId, occurredAt },
  });
}

function successResult(summary: string, data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { status: "ok", summary, data },
  };
}

function failureResult(kind: ErrorKind, summary: string): CallToolResult {
  const error = safeError(kind);
  return {
    isError: true,
    content: [{ type: "text", text: `${error.code}: ${summary}` }],
    structuredContent: { status: "error", summary, error },
  };
}

function logCode(event: string): string {
  return `MCP_${event.replace(/[^A-Za-z0-9]+/gu, "_").toUpperCase()}`.slice(0, 96);
}

async function writeLog(
  runtime: Runtime,
  event: string,
  kind?: ErrorKind,
  fields: Readonly<{
    severity?: "debug" | "info" | "warn" | "error";
    correlationId?: string;
    errorCode?: string;
    action?: string;
    phase?: "started" | "completed" | "failed";
    outcome?: "ok" | "error";
    durationMs?: number;
    tool?: string;
  }> = {},
) {
  const layout = resolveDataRootLayout(runtime.dataRoot);
  await appendOperationalLog(layout.logs, "mcp-server.log", {
    timestamp: now(),
    severity: fields.severity ?? (kind ? "error" : "info"),
    component: "mcp",
    code: logCode(event),
    runId: process.env["CALL_NINA_RUN_ID"] ?? `mcp_${runtime.sessionId.slice("session_".length)}`,
    sessionId: runtime.sessionId,
    ...(fields.correlationId === undefined
      ? {}
      : { correlationId: correlationIdSchema.parse(fields.correlationId) }),
    ...(fields.action === undefined && fields.tool === undefined
      ? {}
      : { action: fields.action ?? fields.tool }),
    ...(fields.phase === undefined ? {} : { phase: fields.phase }),
    ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
    ...(fields.durationMs === undefined ? {} : { durationMs: fields.durationMs }),
    message: kind ? "MCP operation failed." : `MCP ${event.replaceAll("-", " ")}.`,
    ...(kind === undefined && fields.errorCode === undefined
      ? {}
      : {
          metadata: {
            ...(kind === undefined ? {} : { code: errorDefinitions[kind].code }),
            ...(fields.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
          },
        }),
  });
}

function fireLog(
  runtime: Runtime,
  event: string,
  kind?: ErrorKind,
  fields?: Parameters<typeof writeLog>[3],
): void {
  void writeLog(runtime, event, kind, fields).catch(() => undefined);
}

async function withToolLog<T extends CallToolResult>(
  runtime: Runtime,
  tool: string,
  handler: (raw: unknown) => Promise<T>,
  raw: unknown,
): Promise<T> {
  const correlationId = `correlation_${randomUUID().replaceAll("-", "")}`;
  const startedAt = Date.now();
  await writeLog(runtime, "tool-started", undefined, {
    severity: "debug",
    correlationId,
    phase: "started",
    tool,
  }).catch(() => undefined);
  try {
    const result = await handler(raw);
    const failed = typeof result === "object" && "isError" in result && result.isError === true;
    const errorCode =
      failed &&
      typeof result.structuredContent === "object" &&
      result.structuredContent !== null &&
      "error" in result.structuredContent &&
      typeof result.structuredContent.error === "object" &&
      result.structuredContent.error !== null &&
      "code" in result.structuredContent.error &&
      typeof result.structuredContent.error.code === "string"
        ? result.structuredContent.error.code
        : undefined;
    await writeLog(runtime, failed ? "tool-failed" : "tool-completed", undefined, {
      severity: failed ? "warn" : "info",
      correlationId,
      phase: failed ? "failed" : "completed",
      outcome: failed ? "error" : "ok",
      durationMs: Date.now() - startedAt,
      tool,
      ...(errorCode === undefined ? {} : { errorCode }),
    }).catch(() => undefined);
    return result;
  } catch (error) {
    await writeLog(runtime, "tool-failed", "mcp", {
      severity: "error",
      correlationId,
      phase: "failed",
      outcome: "error",
      durationMs: Date.now() - startedAt,
      tool,
    }).catch(() => undefined);
    throw error;
  }
}

function registerLoggedTool(
  server: McpServer,
  runtime: Runtime,
  name: string,
  config: unknown,
  handler: (raw: unknown) => Promise<CallToolResult>,
): void {
  server.registerTool(name, config as never, (raw: unknown) =>
    withToolLog(runtime, name, handler, raw),
  );
}

export async function openRuntimeFromEnvironment(): Promise<Runtime> {
  const bootstrapFile = process.env["CALL_NINA_BOOTSTRAP_FILE"] ?? "";
  if (!path.isAbsolute(bootstrapFile) || bootstrapFile.includes("\0")) {
    throw new Error("OD_MCP_BOOTSTRAP_INVALID");
  }
  const state = await readBootstrapPointer(bootstrapFile);
  if (state.status !== "ready") throw new Error("OD_MCP_DATA_ROOT_UNAVAILABLE");
  const database = await openCallNinaDatabase({
    bootstrapFile,
    dataRoot: state.dataRoot,
    rootGeneration: state.rootGeneration,
  });
  const sessionId = `session_${randomUUID().replaceAll("-", "")}`;
  const runtime = {
    bootstrapFile,
    dataRoot: state.dataRoot,
    rootGeneration: state.rootGeneration,
    sessionId,
    database,
    repository: new CallNinaRepository(database),
  } satisfies Runtime;
  await writeLog(runtime, "startup-ready", undefined, {
    action: "lifecycle/mcp",
    phase: "completed",
    outcome: "ok",
  });
  return runtime;
}

async function withFreshRoot<T>(runtime: Runtime, operation: () => Promise<T>) {
  await assertCurrentDataRootLease({
    bootstrapFile: runtime.bootstrapFile,
    dataRoot: runtime.dataRoot,
    rootGeneration: runtime.rootGeneration,
  });
  return operation();
}

async function withInputFreshRoot<T>(
  runtime: Runtime,
  generation: number,
  operation: () => Promise<T>,
) {
  if (generation !== runtime.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  return withFreshRoot(runtime, operation);
}

function activityType(
  kind: "writing" | "grammar" | "vocabulary" | "reading" | "listening" | "speaking" | "placement",
) {
  if (kind === "vocabulary") return "vocabulary-review" as const;
  if (kind === "listening") return "codex-listening" as const;
  if (kind === "speaking") return "voice-speaking" as const;
  return kind;
}

function learningContextProjection(context: LearningContext, includeGoal: boolean) {
  return {
    learnerId: context.learnerId,
    courseId: context.courseId,
    targetLanguage: context.targetLanguage,
    explanationLanguage: context.explanationLanguage,
    ...(includeGoal ? { goal: context.goal } : {}),
  };
}

export function createProductionServer(runtime: Runtime) {
  let writeQueue = Promise.resolve();
  const serializeWrite = <T>(operation: () => Promise<T>) => {
    const next = writeQueue.then(operation, operation);
    writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const server = new McpServer(productionServerIdentity, {
    instructions: "Call Nina provides bounded local learner context and explicit learning writes.",
  });

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_read_learner_context",
    {
      ...mcpToolContracts.open_deutsch_read_learner_context,
      inputSchema: learnerContextReadInputSchema,
      outputSchema: learnerContextReadResultSchema,
    },
    async (raw) => {
      try {
        const input = learnerContextReadInputSchema.parse(raw);
        return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
          const settings = await runtime.repository.readCurrentLearnerSettings();
          if (!settings) return failureResult("not-found", "No learner profile is configured yet.");
          const data = {
            learningContext: learningContextProjection(
              settings.learningContext,
              input.sections.includes("goals"),
            ),
            ...(input.sections.includes("profile")
              ? {
                  approximateLevel: settings.profile.levelEstimate.currentLevel.toUpperCase() as
                    "A1" | "A2" | "B1" | "B2",
                }
              : {}),
            ...(input.sections.includes("teaching-defaults")
              ? {
                  teachingProfile: settings.profile.defaultTeachingProfileId,
                }
              : {}),
          };
          return successResult("Learner context is ready.", data);
        });
      } catch (error) {
        return failureResult(
          error instanceof Error && error.message.includes("STALE")
            ? "stale-data-root"
            : "validation",
          "Learner context is unavailable.",
        );
      }
    },
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_read_practice_context",
    {
      ...mcpToolContracts.open_deutsch_read_practice_context,
      inputSchema: practiceContextReadInputSchema,
      outputSchema: practiceContextReadResultSchema,
    },
    async (raw) => {
      try {
        const input = practiceContextReadInputSchema.parse(raw);
        return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
          const snapshot = await runtime.repository.readDashboardSnapshot(now().slice(0, 10));
          const scope = await runtime.repository.requireLearningScope();
          const course =
            scope.courseId === "german-foundations" && scope.targetLanguage === "de"
              ? await readLearningCourse(
                  process.env["CALL_NINA_CURRICULUM_ROOT"] ??
                    path.resolve(path.dirname(thisFile), "../../../content/curriculum"),
                )
              : null;
          const pathState = await runtime.repository.readLearningPathState();
          const next = course
            ? (recommendCourseActivity(course, pathState)?.reference ?? null)
            : null;
          const nextUnit = course?.units.find((u) => u.id === next?.unitId);
          const maximum = input.maximumItemsPerSection;
          const include = (
            section: "recommendation" | "mistakes" | "vocabulary" | "learning-path",
          ) => input.focus === "all" || input.focus === section;
          const learningContext = await runtime.repository.requireLearningContext();
          const data = {
            recentAttempts: await runtime.repository.readRecentAttemptEvidence(maximum),
            learningContext: learningContextProjection(learningContext, include("recommendation")),
            learningPath:
              (include("learning-path") || include("recommendation")) && next && nextUnit
                ? {
                    reference: next,
                    title:
                      nextUnit.title[learningContext.explanationLanguage === "de" ? "de" : "en"],
                    objective: (
                      nextUnit.activities.find((a) => a.id === next.activityKey)?.instructions[
                        learningContext.explanationLanguage === "de" ? "de" : "en"
                      ] ??
                      nextUnit.scenario[learningContext.explanationLanguage === "de" ? "de" : "en"]
                    ).slice(0, 1000),
                  }
                : null,
            mistakes: include("mistakes")
              ? snapshot.recurringMistakes.slice(0, maximum).map((mistake) => ({
                  mistakeId: mistake.mistakeId,
                  category: mistake.category.categoryKey,
                  occurrenceCount: mistake.occurrenceCount,
                  summary: `Recurring ${mistake.category.categoryKey} evidence observed ${String(mistake.occurrenceCount)} times.`,
                }))
              : [],
            dueVocabulary: include("vocabulary")
              ? snapshot.dueVocabulary
                  .slice(0, maximum)
                  .map(({ vocabularyId, lemma, dueOn }) => ({ vocabularyId, lemma, dueOn }))
              : [],
            recommendation:
              include("recommendation") && nextUnit
                ? {
                    primary:
                      `Continue: ${nextUnit.title[learningContext.explanationLanguage === "de" ? "de" : "en"]}`.slice(
                        0,
                        500,
                      ),
                    alternatives: snapshot.dueVocabulary.length ? ["Review due vocabulary"] : [],
                  }
                : null,
          };
          return successResult("Practice context is ready.", data);
        });
      } catch (error) {
        return failureResult(
          error instanceof Error && error.message.includes("STALE")
            ? "stale-data-root"
            : "validation",
          "Practice context is unavailable.",
        );
      }
    },
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_read_curriculum_coverage",
    {
      ...mcpToolContracts.open_deutsch_read_curriculum_coverage,
      inputSchema: curriculumCoverageReadInputSchema,
      outputSchema: curriculumCoverageReadResultSchema,
    },
    async (raw) => {
      try {
        const input = curriculumCoverageReadInputSchema.parse(raw);
        const { manifest, availableTopicIds } = await withInputFreshRoot(
          runtime,
          input.dataRootGeneration,
          readCurriculumInventory,
        );
        const entries = (["a1", "a2", "b1", "b2"] as const)
          .flatMap((band) =>
            input.band && input.band.toLowerCase() !== band
              ? []
              : manifest.bands[band].map((entry) => ({ ...entry, band })),
          )
          .filter((entry) => !input.domain || entry.domain === input.domain);
        return successResult("Curriculum coverage is ready.", {
          matchingTopicCount: entries.length,
          topicsWithLessonsCount: entries.filter(({ topicId }) => availableTopicIds.has(topicId))
            .length,
          gaps: entries
            .filter(({ topicId }) => !availableTopicIds.has(topicId))
            .slice(0, 100)
            .map((entry) => ({
              topicId: entry.topicId,
              band: entry.band.toUpperCase() as "A1" | "A2" | "B1" | "B2",
              domain: entry.domain,
              summary: "No lesson content is available for this topic.",
            })),
          nextGap: (() => {
            const gap = selectNextCurriculumGap(manifest, availableTopicIds, {
              ...(input.band === undefined
                ? {}
                : { band: input.band.toLowerCase() as "a1" | "a2" | "b1" | "b2" }),
              ...(input.domain === undefined ? {} : { domain: input.domain }),
            });
            return gap === null
              ? null
              : { ...gap, band: gap.band.toUpperCase() as "A1" | "A2" | "B1" | "B2" };
          })(),
        });
      } catch (error) {
        return failureResult(
          error instanceof Error && error.message.includes("STALE")
            ? "stale-data-root"
            : "validation",
          "Curriculum coverage is unavailable.",
        );
      }
    },
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_read_prepared_voice_activity",
    {
      ...mcpToolContracts.open_deutsch_read_prepared_voice_activity,
      inputSchema: preparedVoiceActivityReadInputSchema,
      outputSchema: preparedVoiceActivityReadResultSchema,
    },
    async (raw) => {
      try {
        const input = preparedVoiceActivityReadInputSchema.parse(raw);
        return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
          const activity =
            input.selector.kind === "activity-id"
              ? await runtime.repository.readPreparedActivity(input.selector.activityId)
              : await runtime.repository.readLatestPreparedVoiceActivity(
                  input.selector.activityKind,
                );
          if (!activity?.context.voiceContext) {
            return failureResult("not-found", "No matching prepared Voice activity was found.");
          }
          const settings = await runtime.repository.readLearnerSettingsForScope(
            activity.context.learningScope,
          );
          return successResult("Prepared Voice activity is ready.", {
            activityId: activity.activityId,
            title: activity.title,
            learningContext: learningContextProjection(settings.learningContext, false),
            preparedAt: activity.preparedAt,
            context: activity.context.voiceContext,
            ...(activity.context.learningPath
              ? { learningPath: activity.context.learningPath }
              : {}),
            ...(activity.context.courseTeaching
              ? { courseTeaching: activity.context.courseTeaching }
              : {}),
            teachingDefaults: {
              explanationLanguage: settings.profile.explanationLanguage,
              teachingProfile:
                settings.profile.defaultTeachingProfileId === "strict-corrector"
                  ? "strict-corrector"
                  : "conversation-partner",
            },
          });
        });
      } catch (error) {
        return failureResult(
          error instanceof Error && error.message.includes("STALE")
            ? "stale-data-root"
            : "validation",
          "The prepared Voice activity is unavailable.",
        );
      }
    },
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_create_activity",
    {
      ...mcpToolContracts.open_deutsch_create_activity,
      inputSchema: activityCreateInputSchema,
      outputSchema: activityCreateResultSchema,
    },
    async (raw) => {
      const perform = async () => {
        try {
          const input = activityCreateInputSchema.parse(raw);
          return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
            const activityId = activityIdSchema.parse(
              deterministicId("activity", input.idempotencyKey),
            );
            const naturalRequest = (
              input.activity.naturalRequest ?? input.activity.instructions
            ).slice(0, 1_000);
            const result = await runtime.repository.savePreparedActivity(
              {
                activityId,
                activityType: activityType(input.activity.kind),
                title: input.activity.title,
                originSurface: "codex",
                context: {
                  learningScope: input.activity.learningScope,
                  naturalRequest,
                  instructions: input.activity.instructions,
                  curriculumTopicIds: input.activity.curriculumTopicIds,
                  mistakeIds: [],
                  vocabularyIds: [],
                  ...(input.activity.voiceContext
                    ? { voiceContext: input.activity.voiceContext }
                    : {}),
                },
                preparedAt: utcInstantSchema.parse(now()),
              },
              input.idempotencyKey,
            );
            return successResult(
              result.replayed
                ? "Activity already existed."
                : "Activity created in the Call Nina Practice library.",
              {
                activityId,
                destinationSurface: "practice" as const,
                persistence: "until-completed-or-deleted" as const,
                replayed: result.replayed,
              },
            );
          });
        } catch (error) {
          return failureResult(
            error instanceof Error && error.message.includes("STALE")
              ? "stale-data-root"
              : error instanceof Error && error.message.includes("CONFLICT")
                ? "conflict"
                : "validation",
            "The activity could not be created.",
          );
        }
      };
      return serializeWrite(perform);
    },
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_save_voice_summary",
    {
      ...mcpToolContracts.open_deutsch_save_voice_summary,
      inputSchema: voiceSummarySaveInputSchema,
      outputSchema: voiceSummarySaveResultSchema,
    },
    async (raw) =>
      serializeWrite(async () => {
        try {
          const input = voiceSummarySaveInputSchema.parse(raw);
          return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
            const settings = await runtime.repository.readLearnerSettingsForScope(
              input.learningScope,
            );
            const linked = input.activity
              ? await runtime.repository.readPreparedActivity(input.activity.activityId)
              : undefined;
            if (input.activity) {
              if (!linked?.context.learningPath || !linked.context.courseTeaching)
                return failureResult("validation", "No matching course activity exists.");
              const course = await readLearningCourse(
                process.env["CALL_NINA_CURRICULUM_ROOT"] ??
                  path.resolve(path.dirname(thisFile), "../../../content/curriculum"),
              );
              resolveCourseReference(course, linked.context.learningPath);
              validateCourseEvidence(
                linked.context.courseTeaching,
                input.activity.objectiveResults,
              );
            }
            const summary = voiceSummarySchema.parse({
              learningScope: input.learningScope,
              ...(input.activity ? { activity: input.activity } : {}),
              schemaVersion: 1,
              voiceSessionId: deterministicId("voice-session", input.idempotencyKey),
              summarizedAt: input.summary.occurredAt,
              scenario: {
                title: input.summary.scenario,
                topic: input.summary.topic,
                targetLevel:
                  linked?.context.voiceContext?.targetLevel ??
                  settings.profile.levelEstimate.currentLevel,
                speakingGoals: [input.summary.topic],
              },
              duration:
                input.summary.durationMilliseconds === null
                  ? { status: "not-reported" }
                  : { status: "known", milliseconds: input.summary.durationMilliseconds },
              observedIssues: input.summary.observedIssues.map((observation) => ({
                category: "vocabulary" as const,
                observation,
                evidenceSummary: observation,
                feedback: observation,
                uncertainty: {
                  level: "some" as const,
                  explanation: "A saved session summary provides bounded observational evidence.",
                },
              })),
              vocabulary: input.summary.vocabularyNotes.map((note) => ({
                lemma: note.slice(0, 160),
                meaning: note.slice(0, 500),
                contextSummary: note.slice(0, 500),
              })),
              feedback: {
                summary: input.summary.feedback,
                strengths: [],
                priorities: input.summary.nextSteps.slice(0, 12),
                uncertainty: {
                  level: "some" as const,
                  explanation: "A saved session summary provides bounded observational evidence.",
                },
              },
              nextSteps: input.summary.nextSteps.map((nextStep) => ({
                title: nextStep.slice(0, 160),
                rationale: nextStep.slice(0, 500),
                naturalRequest: nextStep.slice(0, 1_000),
              })),
            });
            const result = await runtime.repository.saveVoiceSummary(summary, input.idempotencyKey);
            return successResult(
              result.replayed
                ? "Voice summary already existed."
                : "Voice summary saved to History.",
              { voiceSessionId: summary.voiceSessionId, replayed: result.replayed },
            );
          });
        } catch (error) {
          return failureResult(
            error instanceof Error && error.message.includes("STALE")
              ? "stale-data-root"
              : error instanceof Error && error.message.includes("CONFLICT")
                ? "conflict"
                : "validation",
            "The Voice summary could not be saved.",
          );
        }
      }),
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_save_listening_result",
    {
      ...mcpToolContracts.open_deutsch_save_listening_result,
      inputSchema: listeningResultSaveInputSchema,
      outputSchema: listeningResultSaveResultSchema,
    },
    async (raw) =>
      serializeWrite(async () => {
        try {
          const input = listeningResultSaveInputSchema.parse(raw);
          return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
            const attemptId = deterministicId("attempt", input.idempotencyKey);
            const result = await runtime.repository.saveListeningResult({
              attemptId,
              activityId: input.activityId,
              expectedActivityRevision: input.expectedActivityRevision,
              result: input.result,
              occurredAt: input.occurredAt,
              idempotencyKey: input.idempotencyKey,
            });
            return successResult(
              result.replayed
                ? "Listening result already existed."
                : "Structured listening result saved to History.",
              {
                attemptId,
                activityId: input.activityId,
                historyEntryId: result.historyEntryId,
                replayed: result.replayed,
              },
            );
          });
        } catch (error) {
          return failureResult(
            error instanceof Error && error.message.includes("STALE")
              ? "stale-data-root"
              : error instanceof Error && error.message.includes("NOT_FOUND")
                ? "not-found"
                : error instanceof Error && error.message.includes("CONFLICT")
                  ? "conflict"
                  : "validation",
            "The structured listening result could not be saved.",
          );
        }
      }),
  );

  registerLoggedTool(
    server,
    runtime,
    "open_deutsch_save_attempt_feedback",
    {
      ...mcpToolContracts.open_deutsch_save_attempt_feedback,
      inputSchema: attemptFeedbackSaveInputSchema,
      outputSchema: attemptFeedbackSaveResultSchema,
    },
    async (raw) =>
      serializeWrite(async () => {
        try {
          const input = attemptFeedbackSaveInputSchema.parse(raw);
          return await withInputFreshRoot(runtime, input.dataRootGeneration, async () => {
            const attemptId = deterministicId("attempt", input.idempotencyKey);
            const result = await runtime.repository.saveMcpAttemptFeedback({
              attemptId,
              activityId: input.activityId,
              expectedActivityRevision: input.expectedActivityRevision,
              feedback: input.feedback,
              targetAttemptId: input.targetAttemptId,
              savedAt: utcInstantSchema.parse(now()),
              idempotencyKey: input.idempotencyKey,
            });
            return successResult(
              result.replayed
                ? "Attempt feedback already existed."
                : "Attempt feedback saved to History.",
              {
                attemptId: input.targetAttemptId ?? attemptId,
                eventId: `attempt-event_${createHash("sha256")
                  .update(`${input.targetAttemptId ?? attemptId}:feedback:${attemptId}`)
                  .digest("hex")}`,
                activityId: input.activityId,
                replayed: result.replayed,
              },
            );
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          return failureResult(
            message.includes("STALE")
              ? "stale-data-root"
              : message.includes("NOT_FOUND")
                ? "not-found"
                : message.includes("CONFLICT")
                  ? "conflict"
                  : "validation",
            "Attempt feedback could not be saved.",
          );
        }
      }),
  );

  return server;
}

export async function main() {
  let runtime: Runtime | undefined;
  try {
    runtime = await openRuntimeFromEnvironment();
    const activeRuntime = runtime;
    const handle = serveStdio(() => createProductionServer(activeRuntime), {
      onerror: () => {
        if (runtime)
          fireLog(runtime, "protocol-error", "mcp", {
            action: "lifecycle/mcp",
            phase: "failed",
            outcome: "error",
          });
        process.stderr.write("OD_MCP_PROTOCOL_ERROR\n");
      },
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void handle.close().finally(() => {
          runtime?.database.close();
          process.exitCode = 0;
        });
      });
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "OD_MCP_START_FAILED"}\n`);
    runtime?.database.close();
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  await main();
}

export type { Runtime };

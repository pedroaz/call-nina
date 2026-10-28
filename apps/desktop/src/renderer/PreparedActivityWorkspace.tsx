import { ProviderActionSummary } from "./ProviderActionSummary.js";
import type {
  ProviderOperation,
  ActivityId,
  DesktopIpcResponse,
  CallNinaError,
} from "@call-nina/contracts";
import { OperationProgress } from "./OperationProgress.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ConfirmDialog,
  Disclosure,
  Feedback,
  ItemList,
  InfoHint,
} from "./components/ui/index.js";
import styles from "./PracticePage.module.css";
import { ArrowUpRight } from "lucide-react";
import {
  ActivityWorkspace,
  ActivityFrame,
  ActivityReference,
  ActivityFooter,
} from "./components/activity/index.js";
import { OperationError } from "./Startup.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { generatePracticeActivity } from "./generatePracticeActivity.js";

type Prepared = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "activity/resolve" }
>["result"];
export function PreparedActivityWorkspace({
  prepared,
  parentLabel,
  activityBreadcrumbs,
  activityTitle,
  courseCompletionActions,
  onClose,
  onOpenActivity,
  requestAiAccess,
}: {
  prepared: Prepared;
  parentLabel: string;
  activityBreadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }> | undefined;
  activityTitle?: string | undefined;
  courseCompletionActions?: ReactNode;
  onClose: () => void;
  onOpenActivity: (activityId: ActivityId) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const generation = useLearningOperation();
  const busy = generation.busy;
  const [error, setError] = useState<CallNinaError>();
  const [opening, setOpening] = useState(false);
  const [openStatus, setOpenStatus] = useState<"open-requested" | "setup-required">();
  const { activity } = prepared;
  const voice = activity.context.voiceContext;
  const voiceKind =
    activity.activityType === "codex-listening"
      ? "listening"
      : activity.activityType === "voice-speaking"
        ? "speaking"
        : undefined;
  const base = `practice.${voiceKind ?? "speaking"}Flow`;
  const openInCodex = async () => {
    if (opening) return;
    setOpening(true);
    setError(undefined);
    setOpenStatus(undefined);
    try {
      if (!(await requestAiAccess("voice-handoff"))) return;
      const result = await invokeDesktop("voice-activity/open-in-codex", {
        activityId: activity.activityId,
      });
      setOpenStatus(result.status);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setOpening(false);
    }
  };
  const generate = async () => {
    if (!(await requestAiAccess("exercise-generation"))) return;
    setError(undefined);
    try {
      onOpenActivity(
        await generatePracticeActivity(
          {
            source: "prepared-activity",
            activityId: activity.activityId,
            exerciseCount: 6,
          },
          generation.run,
        ),
      );
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  };
  return (
    <ActivityWorkspace
      title={activityTitle ?? activity.title}
      breadcrumbs={activityBreadcrumbs ?? [{ label: parentLabel, onPress: onClose }]}
      data-activity-id={activity.activityId}
      data-root-generation={prepared.rootGeneration}
      data-learning-language={activity.context.learningScope.targetLanguage}
      actions={
        prepared.deletionStatus !== "retained-data" && (
          <ConfirmDialog
            title={t("practice.library.deleteTitle", { title: activity.title })}
            body={t(
              prepared.deletionStatus === "cascade"
                ? "practice.library.deleteCascadeBody"
                : "practice.library.deleteBody",
            )}
            menuLabel={t("ui.activityActions")}
            triggerVariant="quiet"
            trigger={t("practice.session.delete")}
            confirm={t("practice.library.deleteConfirm")}
            cancel={t("actions.cancel")}
            onConfirm={async () => {
              try {
                await invokeDesktop("prepared-activity/delete", {
                  activityId: activity.activityId,
                });
                onClose();
              } catch (cause) {
                setError(normalizeDesktopError(cause).detail);
              }
            }}
          />
        )
      }
    >
      <ActivityFrame
        taskLabel={t("activity.task")}
        reference={
          voice && (
            <ActivityReference
              label={t("activity.reference")}
              items={[
                {
                  id: "brief",
                  label: t("activity.brief"),
                  content: (
                    <article>
                      <h2>{t("activity.brief")}</h2>
                      <p>{activity.context.instructions ?? activity.context.naturalRequest}</p>
                      <p>{voice.scenario}</p>
                      <ItemList>
                        {voice.objectives.map((objective) => (
                          <li key={objective}>{objective}</li>
                        ))}
                      </ItemList>
                    </article>
                  ),
                },
              ]}
            />
          )
        }
        footer={
          <ActivityFooter
            utilities={
              voice && (
                <InfoHint label={t("lessonStudio.voiceSetup")}>
                  <ol className={styles.voiceSteps}>
                    {["voiceStepOne", "voiceStepTwo", "voiceStepThree"].map((step) => (
                      <li key={step}>{t(`${base}.${step}`)}</li>
                    ))}
                  </ol>
                  <p>{t("practice.voiceHandoff.availability")}</p>
                  <p>{t("practice.voiceHandoff.resume")}</p>
                </InfoHint>
              )
            }
          >
            {voice ? (
              <Button
                variant="primary"
                isPending={opening}
                pendingLabel={t("practice.voiceHandoff.opening")}
                trailingIcon={<ArrowUpRight aria-hidden="true" />}
                onPress={() => void openInCodex()}
              >
                {t("practice.voiceHandoff.open")}
              </Button>
            ) : (
              <>
                {busy && (
                  <Button variant="secondary" onPress={generation.cancel}>
                    {t("actions.cancel")}
                  </Button>
                )}
                <Button
                  variant="primary"
                  isPending={busy}
                  pendingLabel={t("exercises.custom.generating")}
                  onPress={() => void generate()}
                >
                  {t("exercises.custom.generate")}
                </Button>
              </>
            )}
          </ActivityFooter>
        }
      >
        <ProviderActionSummary
          operation={voice ? "voice-handoff" : "exercise-generation"}
          busy={busy || opening}
        />
        <OperationProgress progress={generation.progress} />
        {!voice && <p>{activity.context.instructions ?? activity.context.naturalRequest}</p>}
        {voice ? (
          <>
            {openStatus && (
              <Feedback live="polite" tone={openStatus === "setup-required" ? "warning" : "info"}>
                {t(
                  openStatus === "setup-required"
                    ? "practice.voiceHandoff.setupRequired"
                    : "practice.voiceHandoff.openRequested",
                )}
              </Feedback>
            )}
            {voice.questions.length > 0 && (
              <section className={styles.voiceQuestions}>
                <h3>{t(`${base}.questions`)}</h3>
                <ol>
                  {voice.questions.map((question, index) => (
                    <li key={`${index}:${question}`}>
                      <span aria-hidden="true">{index + 1}</span>
                      <p>{question}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <div className={styles.voiceSupport}>
              {!activity.context.learningPath && (
                <div>
                  <p>
                    {voice.targetLevel.toUpperCase()} ·{" "}
                    {t(`${base}.difficultyOptions.${voice.difficulty}`)} ·{" "}
                    {t(`${base}.correctionOptions.${voice.correctionTiming}`)}
                    {voiceKind === "speaking" &&
                      ` · ${t(`practice.paceOptions.${voice.speakingPace ?? "normal"}`)}`}
                  </p>
                </div>
              )}
              {voice.script && (
                <Disclosure density="compact" label={t("lessonStudio.transcript")}>
                  <p
                    className={styles.readingPassage}
                    lang={activity.context.learningScope.targetLanguage}
                  >
                    {voice.script}
                  </p>
                </Disclosure>
              )}
              <Disclosure variant="inline" label={t(`${base}.guidance`)}>
                <ItemList>
                  {voice.answerGuidance.map((guidance) => (
                    <li key={guidance}>{guidance}</li>
                  ))}
                </ItemList>
              </Disclosure>
            </div>
          </>
        ) : null}
        {error &&
          (error.kind === "handoff" ? (
            <Feedback live="assertive" tone="error">
              {t("practice.voiceHandoff.failed")}
            </Feedback>
          ) : (
            <OperationError error={error} />
          ))}
        {courseCompletionActions}
      </ActivityFrame>
    </ActivityWorkspace>
  );
}

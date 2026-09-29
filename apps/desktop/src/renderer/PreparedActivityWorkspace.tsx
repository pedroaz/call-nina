import type {
  ProviderOperation,
  ActivityId,
  DesktopIpcResponse,
  CallNinaError,
} from "@call-nina/contracts";
import { OperationProgress } from "./OperationProgress.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  ConfirmDialog,
  Disclosure,
  Feedback,
  ItemList,
} from "./components/ui/index.js";
import { ActionGroup, Page } from "./components/layout/index.js";
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
  onClose,
  onOpenActivity,
  requestAiAccess,
}: {
  prepared: Prepared;
  parentLabel: string;
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
    <Page title={activity.title} breadcrumbs={[{ label: parentLabel, onPress: onClose }]}>
      <Card as="article" data-activity-id={activity.activityId}>
        <OperationProgress progress={generation.progress} />
        <p>{activity.context.instructions ?? activity.context.naturalRequest}</p>
        {voice ? (
          <>
            <Button
              variant="primary"
              isPending={opening}
              pendingLabel={t("practice.voiceHandoff.opening")}
              onPress={() => void openInCodex()}
            >
              {t("practice.voiceHandoff.open")}
            </Button>
            {openStatus && (
              <Feedback live="polite" tone={openStatus === "setup-required" ? "warning" : "info"}>
                {t(
                  openStatus === "setup-required"
                    ? "practice.voiceHandoff.setupRequired"
                    : "practice.voiceHandoff.openRequested",
                )}
              </Feedback>
            )}
            <h2>{voice.scenario}</h2>
            <p>
              {voice.targetLevel.toUpperCase()} ·{" "}
              {t(`${base}.difficultyOptions.${voice.difficulty}`)} ·{" "}
              {t(`${base}.correctionOptions.${voice.correctionTiming}`)}
              {voiceKind === "speaking" &&
                ` · ${t(`practice.paceOptions.${voice.speakingPace ?? "normal"}`)}`}
            </p>
            <ItemList>
              {voice.objectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ItemList>
            {voice.script && (
              <Disclosure label={t("learningPath.steps.listening")}>
                <p lang="de">{voice.script}</p>
              </Disclosure>
            )}
            <h3>{t(`${base}.questions`)}</h3>
            <ItemList>
              {voice.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ItemList>
            <Disclosure label={t(`${base}.guidance`)}>
              <ItemList>
                {voice.answerGuidance.map((guidance) => (
                  <li key={guidance}>{guidance}</li>
                ))}
              </ItemList>
            </Disclosure>
            <h3>{t(`${base}.voiceStart`)}</h3>
            <ItemList>
              {["voiceStepOne", "voiceStepTwo", "voiceStepThree"].map((step) => (
                <li key={step}>{t(`${base}.${step}`)}</li>
              ))}
            </ItemList>
            <p>{t("practice.voiceHandoff.availability")}</p>
            <p>{t("practice.voiceHandoff.resume")}</p>
          </>
        ) : (
          <ActionGroup>
            <Button
              variant="primary"
              isPending={busy}
              pendingLabel={t("exercises.custom.generating")}
              onPress={() => void generate()}
            >
              {t("exercises.custom.generate")}
            </Button>
            {busy && (
              <Button variant="secondary" onPress={generation.cancel}>
                {t("actions.cancel")}
              </Button>
            )}
          </ActionGroup>
        )}
        {prepared.deletionStatus !== "retained-data" && (
          <ConfirmDialog
            title={t("practice.library.deleteTitle", { title: activity.title })}
            body={t(
              prepared.deletionStatus === "cascade"
                ? "practice.library.deleteCascadeBody"
                : "practice.library.deleteBody",
            )}
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
        )}
        {error &&
          (error.kind === "handoff" ? (
            <Feedback live="assertive" tone="error">
              {t("practice.voiceHandoff.failed")}
            </Feedback>
          ) : (
            <OperationError error={error} />
          ))}
      </Card>
    </Page>
  );
}

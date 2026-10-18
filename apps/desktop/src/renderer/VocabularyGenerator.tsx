import { useEffect, useRef, useState } from "react";
import type { ActivityId, CallNinaError, ProviderOperation } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button, Feedback, ModalDialog, SelectField, TextField } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { OperationProgress } from "./OperationProgress.js";
import styles from "./VocabularyPage.module.css";

export function VocabularyGenerator({
  onClose,
  onOpenActivity,
  requestAiAccess,
}: {
  onClose: () => void;
  onOpenActivity: (id: ActivityId) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const generation = useLearningOperation();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("10");
  const [level, setLevel] = useState<"a1" | "a2" | "b1" | "b2">("a2");
  const [error, setError] = useState<CallNinaError>();
  const [checking, setChecking] = useState(false);
  const edited = useRef(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void invokeDesktop("learner-profile/read", {})
      .then((result) => {
        if (mounted.current && !edited.current && result.status === "ready")
          setLevel(result.profile.approximateLevel);
      })
      .catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = checking || generation.busy;
  const generate = async () => {
    if (locked.current || !topic.trim()) return;
    locked.current = true;
    setError(undefined);
    setChecking(true);
    try {
      if (!(await requestAiAccess("flashcard-generation")) || !mounted.current) return;
      setChecking(false);
      const result = await generation.run({
        kind: "flashcard-generation",
        topic: topic.trim(),
        cardCount: Number(count),
        targetLevel: level,
      });
      if (result.activityId) onOpenActivity(result.activityId);
    } catch (cause) {
      const detail = normalizeDesktopError(cause).detail;
      if (mounted.current && detail.kind !== "cancellation") setError(detail);
    } finally {
      locked.current = false;
      if (mounted.current) setChecking(false);
    }
  };
  return (
    <ModalDialog
      isOpen
      title={t("vocabulary.flow.generate")}
      isDismissable={!busy && !topic}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <p>{t("vocabulary.flow.previewHint")}</p>
      <form
        className={styles.editForm}
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <TextField
          label={t("vocabulary.flow.topic")}
          placeholder={t("vocabulary.flow.placeholder")}
          value={topic}
          required
          maxLength={1000}
          disabled={busy}
          onChange={(event) => {
            setTopic(event.target.value);
          }}
        />
        <div className={styles.toolbar}>
          <SelectField
            label={t("vocabulary.flow.level")}
            value={level}
            disabled={busy}
            onChange={(event) => {
              edited.current = true;
              setLevel(event.target.value as typeof level);
            }}
          >
            {(["a1", "a2", "b1", "b2"] as const).map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("vocabulary.flow.count")}
            value={count}
            disabled={busy}
            onChange={(event) => {
              setCount(event.target.value);
            }}
          >
            {[5, 10, 20].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
        </div>
        {error && (
          <Feedback tone="error" live="assertive">
            {t(error.messageKey)}
          </Feedback>
        )}
        <OperationProgress progress={generation.progress} />
        <ActionGroup>
          <Button type="submit" isPending={busy} isDisabled={busy || !topic.trim()}>
            {t("vocabulary.flow.generate")}
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              if (generation.busy) generation.cancel();
              else if (!checking) onClose();
            }}
            isDisabled={checking}
          >
            {t("actions.cancel")}
          </Button>
        </ActionGroup>
      </form>
    </ModalDialog>
  );
}

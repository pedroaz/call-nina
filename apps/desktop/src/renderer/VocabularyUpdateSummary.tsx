import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Button, Feedback, Disclosure } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { useVocabularyLearning } from "./VocabularyLearning.js";
import type { ActivityId } from "@call-nina/contracts";

export const VocabularyNavigation = createContext<{
  activityId: string | undefined;
  view: (activityId: string | undefined) => void;
}>({ activityId: undefined, view: () => {} });

export function VocabularyUpdateSummary({ activityId }: { activityId: string }) {
  const learning = useVocabularyLearning(activityId);
  const { t } = useTranslation();
  const navigation = useContext(VocabularyNavigation);
  const batches =
    learning.snapshot?.batches.filter((b) => !b.undone && b.activityId === activityId) ?? [];
  const added = new Set(
    batches.flatMap((b) => b.words.filter((w) => w.added).map((w) => w.vocabularyId)),
  );
  const weak = new Set(
    batches.flatMap((b) =>
      b.words
        .filter((w) => !w.added && w.outcome === "difficulty" && !added.has(w.vocabularyId))
        .map((w) => w.vocabularyId),
    ),
  );
  const jobs = learning.snapshot?.jobs.filter((j) => j.activityId === activityId) ?? [];
  const pending = jobs.some((j) => j.state === "pending" || j.state === "running");
  const failed = jobs.some((j) => j.state === "failed" || j.state === "blocked");
  if (learning.readError)
    return (
      <Feedback live="polite">
        <p>{t(learning.readError.messageKey)}</p>
      </Feedback>
    );
  if (!learning.snapshot || (!added.size && !weak.size && !pending && !failed)) return null;
  return (
    <Feedback live="polite">
      {(added.size > 0 || weak.size > 0) && (
        <p>
          {[
            added.size ? t("vocabulary.updates.added", { count: added.size }) : "",
            weak.size ? t("vocabulary.updates.weak", { count: weak.size }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {pending && <p>{t("vocabulary.updates.pending")}</p>}
      {failed && <p>{t("vocabulary.updates.failed")}</p>}
      {learning.error && <p>{t(learning.error)}</p>}
      <ActionGroup>
        {(added.size > 0 || weak.size > 0) && (
          <Button variant="quiet" onPress={() => navigation.view(activityId)}>
            {t("vocabulary.updates.view")}
          </Button>
        )}
        {failed && (
          <Button
            variant="secondary"
            isDisabled={learning.saving}
            onPress={() =>
              void learning.update({ kind: "retry", activityId: activityId as ActivityId })
            }
          >
            {t("actions.retry")}
          </Button>
        )}
      </ActionGroup>
    </Feedback>
  );
}

export function VocabularyUpdates({
  learning,
}: {
  learning: ReturnType<typeof useVocabularyLearning>;
}) {
  const { t } = useTranslation();
  const navigation = useContext(VocabularyNavigation);
  const batches =
    learning.snapshot?.batches.filter(
      (b) => !b.read && !b.undone && b.words.some((w) => w.added || w.outcome === "difficulty"),
    ) ?? [];
  const pendingActivities = [...new Set(learning.snapshot?.jobs.map((j) => j.activityId) ?? [])];
  return (
    <>
      {navigation.activityId && (
        <Button variant="quiet" onPress={() => navigation.view(undefined)}>
          {t("vocabulary.updates.all")}
        </Button>
      )}
      {(batches.length > 0 || pendingActivities.length > 0) && (
        <Disclosure label={t("vocabulary.updates.title")}>
          {batches.map((batch) => (
            <div key={batch.id}>
              <p>
                {batch.words
                  .filter((w) => w.added || w.outcome === "difficulty")
                  .map((w) => w.lemma)
                  .join(" · ")}
              </p>
              <ActionGroup>
                {batch.activityId && (
                  <Button variant="quiet" onPress={() => navigation.view(batch.activityId!)}>
                    {t("vocabulary.updates.view")}
                  </Button>
                )}
                <Button
                  variant="quiet"
                  isDisabled={learning.saving}
                  onPress={() => void learning.update({ kind: "read", batchIds: [batch.id] })}
                >
                  {t("vocabulary.updates.read")}
                </Button>
              </ActionGroup>
            </div>
          ))}
          {pendingActivities.map((activityId) => (
            <VocabularyUpdateSummary key={activityId} activityId={activityId} />
          ))}
          {learning.error && <p role="status">{t(learning.error)}</p>}
        </Disclosure>
      )}
    </>
  );
}

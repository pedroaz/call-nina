import type {
  CourseActivity,
  CourseReference,
  CourseUnit,
  HistoryEntryId,
} from "@call-nina/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  courseLanguageProgress,
  courseOutcomeProgress,
  courseUnitEvidenceComplete,
} from "@call-nina/domain";
import { Button, Disclosure, ItemList, Muted, InfoHint } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import type { LearningPathSnapshot } from "./useLearningPath.js";
import { lessonCounts, courseReference } from "./learningPathNavigation.js";
import styles from "./LearningPathPage.module.css";

export function LearningPathProgress({
  snapshot,
  unit,
  busy,
  launchOrigin,
  launch,
  launchFeedback,
  onOpenHistory,
}: {
  snapshot: LearningPathSnapshot;
  unit: CourseUnit;
  busy: boolean;
  launchOrigin: string | undefined;
  launch: (ref: CourseReference, origin: string) => Promise<void>;
  launchFeedback: (origin: string) => ReactNode;
  onOpenHistory: (ids: HistoryEntryId[]) => void;
}) {
  const { t } = useTranslation();
  const { course, state } = snapshot;
  if (!course) return null;
  const locale =
    snapshot.learningContext.explanationLanguage === "en-US"
      ? "en"
      : snapshot.learningContext.explanationLanguage;
  const reference = (
    unit: CourseUnit,
    activity: CourseActivity | undefined,
    mode: CourseReference["mode"] = "course",
  ) => courseReference(course, unit, activity, mode);
  const counts = (unit: CourseUnit) => lessonCounts(course, state, unit);
  return (
    <section className={styles.unitDetails} aria-label={t("pathFlow.lessonProgress")}>
      <div className={styles.progressSummary}>
        <div className={styles.completion}>
          <progress
            value={counts(unit).completed}
            max={counts(unit).total}
            aria-label={t("learningPath.counts", counts(unit))}
          />
          <span>{t("learningPath.counts", counts(unit))}</span>
        </div>
        <div className={styles.progressStatus}>
          <span>
            {t(
              courseUnitEvidenceComplete(course, state, unit)
                ? "missions.established"
                : "missions.buildingEvidence",
            )}
          </span>
          <InfoHint label={t("lessonStudio.aboutProgress")}>
            {t("missions.progressMeaning")}
          </InfoHint>
        </div>
      </div>
      <div className={styles.unitDetails}>
        <Disclosure density="compact" label={t("pathLibrary.skillDetails")}>
          <ItemList>
            {courseOutcomeProgress(course, state, unit).map((progress) => (
              <li key={progress.objective.id}>
                <strong>{progress.objective.description[locale]}</strong>
                <ItemList>
                  {progress.skills.map((skill) => (
                    <li key={skill.skill}>
                      {t(`history.skills.${skill.skill}`)}:{" "}
                      {t(
                        skill.established
                          ? "missions.established"
                          : skill.latest
                            ? `missions.outcome.${skill.latest.outcome}`
                            : "missions.outcome.not-evaluated",
                      )}
                      {skill.due
                        ? ` · ${t("missions.due")}`
                        : skill.dueAt
                          ? ` · ${t("missions.nextReview", { date: skill.dueAt.slice(0, 10) })}`
                          : ""}
                      {skill.struggling ? ` · ${t("missions.focusedRetry")}` : ""}
                    </li>
                  ))}
                </ItemList>
              </li>
            ))}
          </ItemList>
        </Disclosure>
        <Disclosure density="compact" label={t("missions.constructions")}>
          <ItemList>
            {courseLanguageProgress(course, state, unit).map((p) => (
              <li key={p.target.id}>
                <strong>{p.target.text}</strong> —{" "}
                {t("missions.retrievalCounts", {
                  recognition: p.recognition,
                  recall: p.recall,
                  use: p.use,
                })}
                {p.latest ? ` · ${t(`missions.outcome.${p.latest.outcome}`)}` : ""}
                <ItemList>
                  {p.modes.map((mode) => (
                    <li key={mode.retrieval}>
                      {t(`vocabulary.review.modes.${mode.retrieval}`)}:{" "}
                      {mode.dueAt
                        ? t(mode.due ? "missions.due" : "missions.nextReview", {
                            date: mode.dueAt.slice(0, 10),
                          })
                        : t("missions.outcome.not-evaluated")}
                      {mode.latest && (
                        <Muted as="p">
                          {t(`missions.outcome.${mode.latest.outcome}`)}
                          {mode.latest.support.length
                            ? ` · ${mode.latest.support.map((s) => t(`missions.support.${s}`)).join(", ")}`
                            : ""}
                        </Muted>
                      )}
                      <Button
                        variant="quiet"
                        data-path-focus={`mode:${unit.id}:${p.target.id}:${mode.retrieval}`}
                        isDisabled={busy}
                        isPending={
                          launchOrigin === `mode:${unit.id}:${p.target.id}:${mode.retrieval}`
                        }
                        onPress={() => {
                          const activity = unit.activities.find(
                            (a) => a.delivery === "practice" && a.targetIds.includes(p.target.id),
                          );
                          if (activity)
                            void launch(
                              {
                                ...reference(unit, activity, "review"),
                                retrieval: mode.retrieval,
                              },
                              `mode:${unit.id}:${p.target.id}:${mode.retrieval}`,
                            );
                        }}
                      >
                        {t("missions.practiseMode", {
                          mode: t(`vocabulary.review.modes.${mode.retrieval}`),
                        })}
                      </Button>
                      {launchFeedback(`mode:${unit.id}:${p.target.id}:${mode.retrieval}`)}
                    </li>
                  ))}
                </ItemList>
              </li>
            ))}
          </ItemList>
        </Disclosure>
      </div>
      <ActionGroup className={styles.cardActions}>
        {state.activities.some(
          (a) => a.reference.unitId === unit.id && a.historyEntryIds.length,
        ) && (
          <Button
            variant="secondary"
            onPress={() => {
              onOpenHistory(
                state.activities
                  .filter((a) => a.reference.unitId === unit.id)
                  .flatMap((a) => a.historyEntryIds)
                  .slice(0, 100),
              );
            }}
          >
            {t("missions.savedWork")}
          </Button>
        )}
      </ActionGroup>
    </section>
  );
}

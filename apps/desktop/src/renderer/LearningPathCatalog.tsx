import type { CourseUnit, LearningCourse, LearningPathState } from "@call-nina/contracts";
import { courseActivityStatus } from "@call-nina/domain";
import { ArrowRight, BookOpen, Check, Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card, Muted } from "./components/ui/index.js";
import { ContentGrid, Section } from "./components/layout/index.js";
import styles from "./LearningPathPage.module.css";

export function LearningPathCatalog({
  course,
  state,
  locale,
  view,
  stage,
  selectedUnit,
  busy,
  onStage,
  onSelect,
  onOpen,
}: {
  course: LearningCourse;
  state: LearningPathState;
  locale: "en" | "de";
  view: "library" | "trail";
  stage: string;
  selectedUnit: string | undefined;
  busy: boolean;
  onStage: (stage: string) => void;
  onSelect: (id: string) => void;
  onOpen: (unit: CourseUnit) => void;
}) {
  const { t } = useTranslation();
  const stages = [...new Set(course.units.map((unit) => unit.stage))];
  const title = (value: string) => t("pathLibrary.stage", { stage: value.replace("a1-", "A1.") });
  const statuses = (unit: CourseUnit) =>
    unit.activities.map((activity) =>
      courseActivityStatus(state, {
        version: course.version,
        unitId: unit.id,
        activityKey: activity.id,
        mode: "course",
      }),
    );
  const complete = (unit: CourseUnit) => statuses(unit).every((status) => status === "completed");
  const counts = (unit: CourseUnit) => ({
    completed: statuses(unit).filter((status) => status === "completed").length,
    skipped: statuses(unit).filter((status) => status === "skipped").length,
    total: unit.activities.length,
  });
  const resume = (value: string) => {
    const units = course.units.filter((unit) => unit.stage === value);
    const saved = units.find(
      (unit) =>
        unit.id === state.current?.unitId &&
        statuses(unit).some((status) => !["completed", "skipped"].includes(status)),
    );
    return (
      saved ??
      units.find((unit) => statuses(unit).includes("started")) ??
      units.find(
        (unit) =>
          unit.kind !== "launchpad" &&
          statuses(unit).some((status) => !["completed", "skipped"].includes(status)),
      )
    );
  };
  const activeStages = stages.filter((value) =>
    course.units.some(
      (unit) => unit.stage === value && statuses(unit).some((status) => status !== "not-started"),
    ),
  );
  if (view === "library")
    return (
      <>
        {activeStages.length > 0 && (
          <Section title={t("pathLibrary.resume")}>
            {activeStages.map((value) => {
              const unit = resume(value);
              return (
                <Card key={value} variant="brand" className={styles.recommendation}>
                  <div>
                    <Muted as="p">{title(value)}</Muted>
                    <h2>{unit?.title[locale] ?? t("pathLibrary.pathFinished")}</h2>
                  </div>
                  <Button
                    variant="primary"
                    isDisabled={busy}
                    trailingIcon={<ArrowRight aria-hidden="true" />}
                    onPress={() => (unit ? onOpen(unit) : onStage(value))}
                  >
                    {t(unit ? "pathLibrary.continueLesson" : "pathLibrary.explore")}
                  </Button>
                </Card>
              );
            })}
          </Section>
        )}
        <Section title={t("pathLibrary.foundations")}>
          <ContentGrid>
            {stages.map((value) => {
              const units = course.units.filter((unit) => unit.stage === value);
              return (
                <Card key={value} className={styles.pathCard}>
                  <BookOpen aria-hidden="true" />
                  <h2>{title(value)}</h2>
                  <Muted as="p">{t("pathLibrary.lessonCount", { count: units.length })}</Muted>
                  <p>
                    {t("pathLibrary.lessonProgress", {
                      completed: units.filter(complete).length,
                      total: units.length,
                    })}
                  </p>
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => onStage(value)}
                    trailingIcon={<ArrowRight aria-hidden="true" />}
                  >
                    {t("pathLibrary.explore")}
                  </Button>
                </Card>
              );
            })}
          </ContentGrid>
        </Section>
      </>
    );
  const units = course.units.filter((unit) => unit.stage === stage);
  const selected = units.find((unit) => unit.id === selectedUnit) ?? resume(stage) ?? units[0];
  return (
    <>
      <Muted as="p">
        {t("pathLibrary.lessonProgress", {
          completed: units.filter(complete).length,
          total: units.length,
        })}
      </Muted>
      <div className={styles.trailLayout}>
        <ol className={styles.trail} aria-label={title(stage)}>
          {units.map((unit, index) => (
            <li key={unit.id}>
              <Button
                variant={unit.id === selected?.id ? "primary" : "secondary"}
                aria-pressed={unit.id === selected?.id}
                isDisabled={busy}
                onPress={() => onSelect(unit.id)}
                leadingIcon={
                  complete(unit) ? (
                    <Check aria-hidden="true" />
                  ) : unit.kind === "checkpoint" ? (
                    <Flag aria-hidden="true" />
                  ) : undefined
                }
              >
                <span className={styles.trailStop}>
                  <span>
                    {index + 1}. {unit.title[locale]}
                  </span>
                  <span className={styles.trailMeta}>
                    {unit.kind === "launchpad" ? `${t("missions.optional")} · ` : ""}
                    {t("learningPath.counts", counts(unit))}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ol>
        {selected && (
          <Card variant="brand" className={styles.lessonPreview}>
            <Muted as="p">
              {t(
                selected.kind === "checkpoint"
                  ? "missions.checkpoints"
                  : "pathLibrary.selectedLesson",
              )}
            </Muted>
            <h2>{selected.title[locale]}</h2>
            <p>{selected.scenario[locale]}</p>
            <Muted as="p">{t("learningPath.counts", counts(selected))}</Muted>
            <Button
              variant="primary"
              isDisabled={busy}
              onPress={() => onOpen(selected)}
              trailingIcon={<ArrowRight aria-hidden="true" />}
            >
              {t(complete(selected) ? "pathLibrary.revisitLesson" : "pathLibrary.openLesson")}
            </Button>
          </Card>
        )}
      </div>
    </>
  );
}

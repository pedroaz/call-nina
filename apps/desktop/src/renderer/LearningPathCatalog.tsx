import type { CourseUnit, LearningCourse, LearningPathState } from "@call-nina/contracts";
import { resolveCourseReference } from "@call-nina/domain";
import { ArrowRight, BookOpen, Check, Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { Button, Card, Muted, TextField, SelectField } from "./components/ui/index.js";
import { ActionGroup, ContentRow, Section } from "./components/layout/index.js";
import {
  lessonCounts,
  lessonStateKey,
  lessonActionKey,
  nextLessonActivity,
  nextPathActivity,
} from "./learningPathNavigation.js";
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
  reviewCount,
  onReview,
  filter,
  onFilter,
}: {
  course: LearningCourse;
  state: LearningPathState;
  locale: "en" | "de" | "es" | "pt-BR";
  view: "library" | "trail";
  stage: string;
  selectedUnit: string | undefined;
  busy: boolean;
  onStage: (stage: string) => void;
  onSelect: (id: string) => void;
  onOpen: (unit: CourseUnit) => void;
  reviewCount: number;
  onReview: () => void;
  filter: { query: string; kind: string; level: string };
  onFilter: (filter: { query: string; kind: string; level: string }) => void;
}) {
  const { t } = useTranslation();
  const filters = useRef<HTMLDivElement>(null);
  const { query, kind, level } = filter;
  const normalized = query.trim().toLocaleLowerCase();
  const paths = course.paths.filter(
    (path) =>
      (kind === "all" || path.kind === kind) &&
      (level === "all" || path.level === level) &&
      (!normalized ||
        `${path.title[locale]} ${path.description[locale]}`
          .toLocaleLowerCase()
          .includes(normalized)),
  );
  const title = (value: string) =>
    course.paths.find((path) => path.id === value)?.title[locale] ?? value;
  const counts = (unit: CourseUnit) => lessonCounts(course, state, unit);
  const complete = (unit: CourseUnit) => counts(unit).completed === counts(unit).total;
  const next = nextPathActivity(course, state);
  const recommendation = next ? resolveCourseReference(course, next) : null;
  const review =
    reviewCount > 0 ? (
      <div className={styles.reviewEntry}>
        <span>{t("pathFlow.reviewDue", { count: reviewCount })}</span>
        <Button
          variant="quiet"
          density="compact"
          isDisabled={busy}
          onPress={onReview}
          data-path-focus="review-entry"
          trailingIcon={<ArrowRight aria-hidden="true" />}
        >
          {t("ui.review")}
        </Button>
      </div>
    ) : null;
  const progress = (units: CourseUnit[]) => (
    <div className={styles.pathProgress}>
      <span>
        {t("pathLibrary.lessonProgress", {
          completed: units.filter(complete).length,
          total: units.length,
          count: units.length,
        })}
      </span>
      <progress
        value={units.filter(complete).length}
        max={units.length}
        aria-label={t("pathLibrary.yourProgress")}
      />
    </div>
  );
  if (view === "library") {
    const started = course.units.some((unit) => {
      const c = counts(unit);
      return c.started || c.completed || c.skipped;
    });
    return (
      <>
        <div className={styles.librarySummary}>
          <Card variant="brand" density="compact" className={styles.recommendation}>
            {recommendation ? (
              <>
                <div className={styles.summaryText}>
                  <Muted>{title(recommendation.unit.stage)}</Muted>
                  <h2>{recommendation.unit.title[locale]}</h2>
                  <p>{t("pathFlow.next", { activity: recommendation.activity.title[locale] })}</p>
                  <Muted className={styles.summaryMeta}>
                    {t("learningPath.counts", counts(recommendation.unit))}
                  </Muted>
                </div>
                <Button
                  variant="primary"
                  isDisabled={busy}
                  data-path-focus="continue-learning"
                  onPress={() => {
                    onOpen(recommendation.unit);
                  }}
                  trailingIcon={<ArrowRight aria-hidden="true" />}
                >
                  {t(started ? "pathFlow.continueLearning" : "pathFlow.startLearning")}
                </Button>
              </>
            ) : (
              <div className={styles.summaryText}>
                <h2>{t("pathFlow.pathSummary")}</h2>
                {progress(course.units)}
                <p>
                  {t("pathFlow.skippedCount", {
                    count: course.units.reduce((sum, unit) => sum + counts(unit).skipped, 0),
                  })}
                </p>
              </div>
            )}
          </Card>
          {review}
        </div>
        <Section
          title={t("pathFlow.explorePaths")}
          actions={
            <ActionGroup>
              <Muted as="span" className={styles.resultCount} role="status">
                {t("pathCatalog.results", { count: paths.length, total: course.paths.length })}
              </Muted>
              {(query || kind !== "all" || level !== "all") && (
                <Button
                  variant="quiet"
                  density="compact"
                  onPress={() => {
                    onFilter({ query: "", kind: "all", level: "all" });
                    filters.current?.querySelector("input")?.focus();
                  }}
                >
                  {t("vocabulary.flow.clearFilters")}
                </Button>
              )}
            </ActionGroup>
          }
        >
          <div ref={filters} className={styles.catalogFilters}>
            <TextField
              density="compact"
              type="search"
              label={t("pathCatalog.search")}
              value={query}
              onChange={(event) => {
                onFilter({ ...filter, query: event.target.value });
              }}
            />
            <SelectField
              density="compact"
              label={t("pathCatalog.kind")}
              value={kind}
              onChange={(event) => {
                onFilter({ ...filter, kind: event.target.value });
              }}
            >
              <option value="all">{t("pathCatalog.allKinds")}</option>
              <option value="course">{t("pathCatalog.course")}</option>
              <option value="scenario">{t("pathCatalog.scenario")}</option>
            </SelectField>
            <SelectField
              density="compact"
              label={t("pathCatalog.level")}
              value={level}
              onChange={(event) => {
                onFilter({ ...filter, level: event.target.value });
              }}
            >
              <option value="all">{t("pathCatalog.allLevels")}</option>
              {[...new Set(course.paths.map((path) => path.level))].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
          </div>
          {!paths.length && <p>{t("pathCatalog.noResults")}</p>}
          <div className={styles.pathList}>
            {paths.map((path) => {
              const value = path.id;
              const units = course.units.filter((unit) => unit.stage === value);
              return (
                <ContentRow
                  key={value}
                  className={styles.clickablePath}
                  leading={
                    <span className={styles.pathIcon}>
                      <BookOpen aria-hidden="true" />
                    </span>
                  }
                  metadata={progress(units)}
                  actions={
                    <Button
                      variant="quiet"
                      className={styles.pathOpen}
                      density="compact"
                      isDisabled={busy}
                      aria-label={title(value)}
                      data-path-focus={`explore:${value}`}
                      onPress={() => {
                        onStage(value);
                      }}
                    >
                      <span className={styles.pathOpenAffordance}>
                        <ArrowRight aria-hidden="true" />
                      </span>
                    </Button>
                  }
                >
                  <div className={styles.pathHeading}>
                    <h3>{title(value)}</h3>
                    <Muted as="span" className={styles.pathMeta}>
                      {path.level} · {t(`pathCatalog.${path.kind}`)}
                    </Muted>
                  </div>
                  <p>{path.description[locale]}</p>
                </ContentRow>
              );
            })}
          </div>
        </Section>
      </>
    );
  }
  const units = course.units.filter((unit) => unit.stage === stage);
  const selected =
    units.find((unit) => unit.id === selectedUnit) ??
    units.find((unit) => unit.id === next?.unitId) ??
    units.find((unit) => unit.kind !== "launchpad" && nextLessonActivity(course, state, unit)) ??
    units[0];
  return (
    <>
      {progress(units)}
      {review}
      <ol className={styles.trail} aria-label={title(stage)}>
        {units.map((unit, index) => (
          <li key={unit.id} className={styles.trailItem}>
            <Button
              className={styles.trailButton}
              variant="secondary"
              aria-pressed={unit.id === selected?.id}
              data-path-focus={`trail:${unit.id}`}
              isDisabled={busy}
              onPress={() => {
                onSelect(unit.id);
              }}
            >
              <span className={styles.trailMarker}>
                {complete(unit) ? (
                  <Check aria-hidden="true" />
                ) : unit.kind === "checkpoint" ? (
                  <Flag aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span className={styles.trailStop}>
                <strong>{unit.title[locale]}</strong>
                <span className={styles.trailMeta}>
                  {unit.kind === "launchpad"
                    ? `${t("missions.optional")} · `
                    : unit.kind === "checkpoint"
                      ? `${t("missions.checkpoints")} · `
                      : ""}
                  {t(lessonStateKey(course, state, unit))}
                </span>
                <span className={styles.trailMeta}>{t("learningPath.counts", counts(unit))}</span>
              </span>
            </Button>
            {selected?.id === unit.id && (
              <Card variant="brand" className={styles.lessonPreview}>
                <Muted>
                  {t(
                    unit.kind === "checkpoint"
                      ? "missions.checkpoints"
                      : "pathLibrary.selectedLesson",
                  )}
                </Muted>
                <h2>{unit.title[locale]}</h2>
                <p>{unit.scenario[locale]}</p>
                <Muted>{t("learningPath.counts", counts(unit))}</Muted>
                <Button
                  variant="primary"
                  isDisabled={busy}
                  data-path-focus={`open:${unit.id}`}
                  onPress={() => {
                    onOpen(unit);
                  }}
                  trailingIcon={<ArrowRight aria-hidden="true" />}
                >
                  {t(lessonActionKey(course, state, unit))}
                </Button>
                {nextLessonActivity(course, state, unit) && (
                  <Muted>
                    {t("pathFlow.next", {
                      activity: nextLessonActivity(course, state, unit)?.title[locale],
                    })}
                  </Muted>
                )}
              </Card>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

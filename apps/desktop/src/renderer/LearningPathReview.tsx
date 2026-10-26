import type { CourseReference } from "@call-nina/contracts";
import { dueCourseReviews, resolveCourseReference } from "@call-nina/domain";
import type { ReactNode } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LearningPathSnapshot } from "./useLearningPath.js";
import { ActivityVisual } from "./activityPresentation.js";
import { Button, Card, Disclosure, Muted } from "./components/ui/index.js";
import { ContentRow } from "./components/layout/index.js";
import styles from "./LearningPathPage.module.css";

export function LearningPathReview({
  snapshot,
  stage,
  busy,
  launchOrigin,
  launch,
  launchFeedback,
  onReturn,
  returnLabel,
}: {
  snapshot: LearningPathSnapshot;
  stage: string | undefined;
  busy: boolean;
  launchOrigin: string | undefined;
  launch: (ref: CourseReference, origin: string) => Promise<void>;
  launchFeedback: (origin: string) => ReactNode;
  onReturn: () => void;
  returnLabel: string;
}) {
  const { t } = useTranslation();
  const { course, state } = snapshot;
  if (!course) return null;
  const locale =
    snapshot.learningContext.explanationLanguage === "en-US"
      ? "en"
      : snapshot.learningContext.explanationLanguage;
  const due = dueCourseReviews(course, state).filter(
    (item) =>
      !stage ||
      course.units.some((unit) => unit.id === item.reference.unitId && unit.stage === stage),
  );
  return (
    <div className={styles.unit}>
      <Muted>
        {stage
          ? (course.paths.find((path) => path.id === stage)?.title[locale] ?? stage)
          : t("pathLibrary.allPaths")}
      </Muted>
      <h2>
        {t(due.length ? "pathFlow.reviewDue" : "pathLibrary.allCaughtUp", { count: due.length })}
      </h2>
      {due.map((item) => {
        const { unit, activity } = resolveCourseReference(course, item.reference);
        const origin = `review:${unit.id}:${item.objectiveId}:${item.reference.retrieval ?? activity.id}`;
        return (
          <ContentRow
            variant="bordered"
            key={origin}
            leading={<ActivityVisual kind={activity.delivery} />}
          >
            <Muted>
              {course.paths.find((path) => path.id === unit.stage)?.title[locale] ?? unit.stage} ·{" "}
              {unit.title[locale]}
            </Muted>
            <h2>{activity.title[locale]}</h2>
            {item.reference.retrieval && (
              <Muted>{t(`vocabulary.review.modes.${item.reference.retrieval}`)}</Muted>
            )}
            <div className={styles.reviewActions}>
              <span className={styles.reviewReason}>
                <RotateCcw aria-hidden="true" />
                {t(item.struggling ? "pathLibrary.focusedReview" : "pathLibrary.refreshReview")}
              </span>
              <Button
                variant="primary"
                isDisabled={busy}
                isPending={launchOrigin === origin}
                data-path-focus={origin}
                onPress={() => void launch(item.reference, origin)}
                trailingIcon={<ArrowRight aria-hidden="true" />}
              >
                {t("missions.startReview")}
              </Button>
            </div>
            {launchFeedback(origin)}
          </ContentRow>
        );
      })}
      <Disclosure label={t("pathLibrary.aboutReview")}>
        <p>{t("missions.reviewMeaning")}</p>
      </Disclosure>
      <Card variant="brand" className={styles.recommendation}>
        <p>{t("pathFlow.returnHint")}</p>
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={onReturn}
          trailingIcon={<ArrowRight aria-hidden="true" />}
        >
          {returnLabel}
        </Button>
      </Card>
    </div>
  );
}

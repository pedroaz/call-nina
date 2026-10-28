import type { CourseUnit } from "@call-nina/contracts";
import { Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Feedback, ItemList, Tabs } from "./components/ui/index.js";
import { ActionGroup, Section } from "./components/layout/index.js";
import type { LearningPathSnapshot } from "./useLearningPath.js";
import styles from "./LearningPathPage.module.css";

export function LessonGuide({
  snapshot,
  selected,
  busy,
  scenarioLocked = false,
  changingSituation,
  situationChanged,
  vocabularyAdded,
  onAddVocabulary,
  onChangeSituation,
}: {
  snapshot: LearningPathSnapshot;
  selected: CourseUnit;
  busy: boolean;
  scenarioLocked?: boolean;
  changingSituation: boolean;
  situationChanged: boolean;
  vocabularyAdded: number | undefined;
  onAddVocabulary: () => void;
  onChangeSituation: () => void;
}) {
  const { t } = useTranslation();
  const { course, state } = snapshot;
  if (!course) return null;
  const locale =
    snapshot.learningContext.explanationLanguage === "en-US"
      ? "en"
      : snapshot.learningContext.explanationLanguage;
  const selectedMission = state.missions.find(
    (mission) =>
      mission.unitId === selected.id &&
      mission.version === course.version &&
      mission.mode === "course",
  );
  return (
    <Tabs
      label={t("lessonStudio.resources")}
      density="compact"
      items={[
        {
          id: "overview",
          label: t("ui.overview"),
          children: (
            <Section>
              <h3>{t("missions.sharedFacts")}</h3>

              <section className={styles.scenario}>
                <p>{selectedMission?.facts ?? selected.scenario[locale]}</p>
              </section>
              <ActionGroup className={styles.cardActions}>
                <Button
                  variant="secondary"
                  isPending={changingSituation}
                  isDisabled={busy || scenarioLocked}
                  onPress={() => onChangeSituation()}
                >
                  {t("missions.newContext")}
                </Button>
              </ActionGroup>
              <p>{t("missions.newContextHint")}</p>
              {situationChanged && (
                <Feedback tone="success" live="polite">
                  {t("missions.contextUpdated")}
                </Feedback>
              )}
              <h3>{t("ui.learningGoals")}</h3>

              <ul className={styles.lessonGoals}>
                {selected.objectives.map((o) => (
                  <li key={o.id}>
                    <Target aria-hidden="true" />
                    <span>{o.description[locale]}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ),
        },
        {
          id: "explanation",
          label: t("ui.explanation"),
          children: (
            <Section>
              <p>{selected.explanation[locale]}</p>
              <p>{selected.grammar[locale]}</p>
              <h3>{t("lessonStudio.examples")}</h3>
              <dl className={styles.words}>
                {selected.examples.map((example, index) => (
                  <div key={index}>
                    <dt lang={snapshot.learningContext.targetLanguage}>{example.text}</dt>
                    <dd>{example.meaning[locale]}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ),
        },
        {
          id: "vocabulary",
          label: t("nav.vocabulary"),
          children: (
            <Section>
              <ActionGroup>
                <Button variant="secondary" isDisabled={busy} onPress={onAddVocabulary}>
                  {t("missions.addVocabulary")}
                </Button>
              </ActionGroup>
              {vocabularyAdded !== undefined && (
                <Feedback live="polite">
                  {t("missions.vocabularyAdded", { count: vocabularyAdded })}
                </Feedback>
              )}
              <dl className={styles.words}>
                {course.targets
                  .filter((target) => selected.targetIds.includes(target.id))
                  .map((target) => (
                    <div key={target.id}>
                      <dt lang={snapshot.learningContext.targetLanguage}>{target.text}</dt>
                      <dd>{target.meaning[locale]}</dd>
                    </div>
                  ))}
              </dl>
              <p>{t("missions.reuses")}</p>
              <ItemList>
                {course.targets
                  .filter((target) => selected.reviewTargetIds.includes(target.id))
                  .map((target) => (
                    <li key={target.id} lang={snapshot.learningContext.targetLanguage}>
                      {target.text}
                    </li>
                  ))}
              </ItemList>
            </Section>
          ),
        },
      ]}
    />
  );
}

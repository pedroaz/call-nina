import { useEffect, useRef, useState } from "react";
import { Button, ModalDialog } from "@call-nina/browser-ui";
import ninaWelcome from "@call-nina/design-system/brand/nina-welcome.png";
import ninaThinking from "@call-nina/design-system/brand/nina-thinking.png";
import ninaListening from "@call-nina/design-system/brand/nina-listening.png";
import ninaCelebration from "@call-nina/design-system/brand/nina-celebration.png";
import { copy, type FeatureId, type Locale } from "./locales";
import { LanguageSelector } from "./LanguageSelector";
import {
  connections,
  discoveryCopy,
  emptyState,
  examples,
  learningLanguages,
  readDiscovery,
  recommendedFeature,
  roles,
  storageKey,
  uses,
  type Answers,
  type Connection,
  type LearningLanguage,
  type Role,
  type Use,
} from "./discovery";
import "./discovery.css";

function ExamplePreview({ answers, locale }: { answers: Answers; locale: Locale }) {
  const [revealed, setRevealed] = useState(false);
  const t = discoveryCopy[locale];
  if (!answers.language || !answers.use) return null;
  const example = examples[answers.language];
  const feature = recommendedFeature(answers);
  return (
    <section className="discovery-example" aria-labelledby="discovery-example-title">
      <h4 id="discovery-example-title">{t.example}</h4>
      {feature === "writing" ? (
        <>
          <p>{t.writingPrompt}</p>
          <p className="discovery-sample" lang={answers.language}>
            <del>{example.original}</del>
            <br />
            <ins>{example.correction}</ins>
          </p>
          <p>{example.explanation[locale]}</p>
        </>
      ) : feature === "vocabulary" ? (
        <>
          <p>{t.vocabularyPrompt}</p>
          <p className="discovery-sample" lang={answers.language}>
            {example.word}
          </p>
          <p>{example.meaning[locale]}</p>
          <p lang={answers.language}>{example.wordSentence}</p>
        </>
      ) : (
        <>
          <p>{feature === "paths" ? t.lessonPrompt : t.practicePrompt}</p>
          {feature === "paths" && <p lang={answers.language}>{example.lesson}</p>}
          <p className="discovery-sample" lang={answers.language}>
            {example.sentence}
          </p>
          <Button
            variant="quiet"
            density="compact"
            aria-expanded={revealed}
            aria-controls="discovery-answer"
            onPress={() => setRevealed(!revealed)}
          >
            {revealed ? t.hide : t.reveal}
          </Button>
          <p id="discovery-answer" style={{ visibility: revealed ? "visible" : "hidden" }}>
            {t.answer}: <strong lang={answers.language}>{example.answer}</strong>
          </p>
        </>
      )}
    </section>
  );
}

export function Discovery({
  locale,
  onLocaleChange,
  onExplore,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onExplore: (feature?: FeatureId) => void;
}) {
  const [state, setState] = useState(readDiscovery);
  const [open, setOpen] = useState(() => !state.seen);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusQuestion = useRef(false);
  const t = discoveryCopy[locale];
  const { answers, step, complete } = state;
  const feature = recommendedFeature(answers);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...state, seen: true }));
    } catch {
      /* Storage is optional. */
    }
  }, [state]);
  useEffect(() => {
    if (focusQuestion.current) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "nearest" });
      focusQuestion.current = false;
    }
  }, [step, complete, answers]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function goTo(next: number) {
    focusQuestion.current = true;
    setState((current) => ({ ...current, step: next, complete: false }));
  }
  function choose(value: string) {
    setState((current) => {
      const next = { ...current.answers };
      if (step === 0) {
        if (next.role !== value) delete next.use;
        next.role = value as Role;
      } else if (step === 1) next.language = value as LearningLanguage;
      else if (step === 2) next.use = value as Use;
      else next.connection = value as Connection;
      return { ...current, answers: next, complete: false };
    });
  }
  const options =
    step === 0
      ? roles.map((value) => ({ value, label: t.roles[value] }))
      : step === 1
        ? learningLanguages.map((value) => ({ value, label: t.languages[value] }))
        : step === 2
          ? (answers.role ? uses[answers.role] : []).map((value) => ({
              value,
              label: t.uses[value],
            }))
          : connections.map((value) => ({ value, label: t.connections[value] }));
  const selected = [answers.role, answers.language, answers.use, answers.connection][step];
  const question =
    step === 0
      ? t.roleQuestion
      : step === 1
        ? t.languageQuestion[answers.role ?? "student"]
        : step === 2
          ? t.useQuestion
          : t.connectionQuestion;
  const selections = [
    answers.role ? t.roles[answers.role] : undefined,
    answers.language ? t.languages[answers.language] : undefined,
    answers.use ? t.uses[answers.use] : undefined,
    answers.connection ? t.connections[answers.connection] : undefined,
  ];
  const narrative = [
    answers.role ? t.roleIntro[answers.role] : t.intro,
    answers.language && answers.role
      ? answers.use
        ? t.recommendation(t.languages[answers.language], answers.use)
        : t.languageStory(t.languages[answers.language], answers.role)
      : undefined,
    answers.connection ? t.guidance[answers.connection] : undefined,
  ];
  const art = complete
    ? ninaCelebration
    : [ninaWelcome, ninaListening, ninaThinking, ninaWelcome][step];

  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        onPress={() => {
          setState({ ...emptyState, seen: true, answers: {} });
          setOpen(true);
        }}
      >
        {t.title}
      </Button>
      <ModalDialog
        isOpen={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t.title}
        size="large"
        closeLabel={t.close}
      >
        <div className="discovery-language">
          <span>{copy[locale].language}</span>
          <LanguageSelector locale={locale} onChange={onLocaleChange} />
          <Button
            className="discovery-restart"
            variant="quiet"
            onPress={() => {
              focusQuestion.current = true;
              setState({ ...emptyState, seen: true, answers: {} });
            }}
          >
            {t.restart}
          </Button>
        </div>
        <div className="discovery-layout">
          <div className="discovery-questions">
            <img className="discovery-nina" src={art} alt="" width="180" height="180" />
            <div className="discovery-step">
              <h3 ref={heading} tabIndex={-1} id="discovery-question">
                {complete ? t.ready : question}
              </h3>
              {complete ? (
                <p>{t.readyText}</p>
              ) : (
                <>
                  <p className="discovery-progress">{t.step(step + 1)}</p>
                  <fieldset className="discovery-choices" aria-labelledby="discovery-question">
                    {options.map((option) => (
                      <label key={option.value} className="discovery-choice">
                        <input
                          type="radio"
                          name={`discovery-${step}`}
                          value={option.value}
                          checked={selected === option.value}
                          onChange={() => choose(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
              <div className="discovery-navigation">
                {(step > 0 || complete) && (
                  <Button variant="quiet" onPress={() => goTo(complete ? 3 : step - 1)}>
                    {t.back}
                  </Button>
                )}
                {!complete && (
                  <Button
                    isDisabled={!selected}
                    onPress={() => {
                      if (step < 3) goTo(step + 1);
                      else {
                        const missing = [
                          answers.role,
                          answers.language,
                          answers.use,
                          answers.connection,
                        ].findIndex((answer) => !answer);
                        if (missing >= 0) goTo(missing);
                        else {
                          focusQuestion.current = true;
                          setState((current) => ({ ...current, complete: true }));
                        }
                      }
                    }}
                  >
                    {step === 3 ? t.finish : t.next}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <aside className="discovery-recommendation" aria-labelledby="discovery-summary">
            <div className="discovery-summary">
              <h3 id="discovery-summary">{t.summary}</h3>
              <Button
                onPress={() => {
                  setOpen(false);
                  onExplore(feature);
                }}
              >
                {t.call}
              </Button>
              <div className="discovery-narrative" aria-live="polite" aria-atomic="true">
                {narrative.map((paragraph, index) =>
                  paragraph ? <p key={index}>{paragraph}</p> : null,
                )}
              </div>
              <div className="discovery-selections">
                {selections.map((label, index) =>
                  label ? (
                    <Button
                      key={index}
                      density="compact"
                      variant="quiet"
                      aria-label={t.edit(label)}
                      onPress={() => goTo(index)}
                    >
                      {label}
                    </Button>
                  ) : null,
                )}
              </div>
            </div>
            <div className="discovery-preview-slot">
              <ExamplePreview
                key={`${answers.language}-${answers.use}`}
                answers={answers}
                locale={locale}
              />
            </div>
            {answers.role && answers.role !== "student" && (
              <div className="discovery-professional">
                <a href="mailto:pedro.azvm@gmail.com">{t.contact}</a>
                <p>{t.professional}</p>
              </div>
            )}
          </aside>
        </div>
        <div className="discovery-mobile-action">
          <span>
            {[
              answers.role && t.roles[answers.role],
              answers.language && t.languages[answers.language],
            ]
              .filter(Boolean)
              .join(" · ") || t.summary}
          </span>
          <Button
            density="compact"
            onPress={() => {
              setOpen(false);
              onExplore(feature);
            }}
          >
            {t.call}
          </Button>
        </div>
      </ModalDialog>
    </>
  );
}

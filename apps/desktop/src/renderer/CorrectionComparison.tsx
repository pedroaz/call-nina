import type { AppServerCandidateOutputMap } from "@call-nina/contracts";
import { alignCorrectionTexts } from "@call-nina/domain";
import { useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, DiffView, Disclosure, Muted, ItemList } from "./components/ui/index.js";

import styles from "./CorrectionComparison.module.css";

type CorrectionOutput = AppServerCandidateOutputMap["writing-correction"];
type ChangedSegment = Exclude<
  ReturnType<typeof alignCorrectionTexts>[number],
  { readonly kind: "unchanged" }
>;

function ChangedText({
  segment,
  side,
}: {
  segment: ChangedSegment;
  side: "inline" | "original" | "corrected";
}) {
  const { t } = useTranslation();
  if (side === "original") {
    return segment.originalText ? (
      <del>{segment.originalText}</del>
    ) : (
      <em>{t("writing.inserted")}</em>
    );
  }
  if (side === "corrected") {
    return segment.correctedText ? (
      <ins>{segment.correctedText}</ins>
    ) : (
      <em>{t("writing.removed")}</em>
    );
  }
  return (
    <>
      {segment.kind === "insertion" ? <Plus aria-hidden="true" /> : null}
      {segment.originalText ? <del>{segment.originalText}</del> : null}
      {segment.kind === "replacement" ? <ArrowRight aria-hidden="true" /> : null}
      {segment.correctedText ? <ins>{segment.correctedText}</ins> : null}
      {segment.kind === "deletion" ? <Minus aria-hidden="true" /> : null}
    </>
  );
}

function AlignedPane({
  alignment,
  selectedId,
  side,
  onSelect,
}: {
  alignment: ReturnType<typeof alignCorrectionTexts>;
  selectedId: string | undefined;
  side: "original" | "corrected";
  onSelect: (changeId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <p className={styles.correctionText}>
      {alignment.map((segment, index) =>
        segment.kind === "unchanged" ? (
          <span key={`unchanged-${String(index)}`}>{segment.text}</span>
        ) : (
          <Button
            aria-label={t("writing.selectChange", { number: Number(segment.changeId.slice(7)) })}
            aria-pressed={selectedId === segment.changeId}
            className={styles.correctionChange}
            key={segment.changeId}
            onPress={() => {
              onSelect(segment.changeId);
            }}
          >
            <ChangedText segment={segment} side={side} />
          </Button>
        ),
      )}
    </p>
  );
}

export function CorrectionComparison({
  originalText,
  correction,
  onHelperSelection,
}: {
  originalText: string;
  correction: CorrectionOutput;
  onHelperSelection?: (selectedText: string) => void;
}) {
  const { t } = useTranslation();
  const alignment = useMemo(
    () => alignCorrectionTexts(originalText, correction.correctedText, correction.changes),
    [correction, originalText],
  );
  const changes = alignment.filter((segment) => segment.kind !== "unchanged");
  const [selectedId, setSelectedId] = useState(changes[0]?.changeId);
  const selected = changes.find((segment) => segment.changeId === selectedId) ?? changes[0];
  const candidate =
    selected && selected.candidateIndex !== null
      ? correction.changes[selected.candidateIndex]
      : undefined;

  const candidateFor = (segment: ChangedSegment) =>
    segment.candidateIndex === null ? undefined : correction.changes[segment.candidateIndex];
  const selectChange = (segment: ChangedSegment) => {
    setSelectedId(segment.changeId);
    const selectedText = [segment.originalText, segment.correctedText].filter(Boolean).join(" → ");
    if (selectedText) onHelperSelection?.(selectedText);
  };

  return (
    <article className={styles.correctionReady} aria-label={t("writing.correctionReady")}>
      <p className={styles.eyebrow}>{t("writing.correctionReady")}</p>
      <h2>{t("writing.correctedText")}</h2>
      {changes.length === 0 && (
        <p className={styles.correctedPriority}>{correction.correctedText}</p>
      )}
      <Muted as="p">{correction.summary}</Muted>
      {changes.length > 0 ? (
        <>
          <h3>{t("writing.inlineCorrection")}</h3>
          <p
            aria-label={t("writing.changeSelectionHelp")}
            className={`${styles.correctionText} ${styles.inlineCorrection}`}
          >
            {alignment.map((segment, index) =>
              segment.kind === "unchanged" ? (
                <span key={`unchanged-${String(index)}`}>{segment.text}</span>
              ) : (
                <Button
                  aria-label={t("writing.selectChange", {
                    number: Number(segment.changeId.slice(7)),
                  })}
                  aria-pressed={selected?.changeId === segment.changeId}
                  className={styles.correctionChange}
                  key={segment.changeId}
                  onPress={() => {
                    selectChange(segment);
                  }}
                >
                  <ChangedText segment={segment} side="inline" />
                </Button>
              ),
            )}
          </p>
          <Disclosure label={t("writing.mistakes", { count: changes.length })}>
            <ul className={styles.correctionMistakes}>
              {changes.map((segment) => {
                const itemCandidate = candidateFor(segment);
                return (
                  <li key={segment.changeId}>
                    <Button
                      aria-pressed={selected?.changeId === segment.changeId}
                      className={styles.correctionMistake}
                      onPress={() => {
                        selectChange(segment);
                      }}
                    >
                      <strong>
                        {t("writing.changeHeading", {
                          number: Number(segment.changeId.slice(7)),
                        })}
                      </strong>
                      <span>
                        {itemCandidate
                          ? t(`writing.changeCategories.${itemCandidate.category}`)
                          : t("writing.changedText")}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Disclosure>
          <section className={styles.correctionHelper} aria-live="polite">
            <h3>{t("writing.changeHeading", { number: Number(selected?.changeId.slice(7)) })}</h3>
            <p>
              <strong>
                {candidate
                  ? t(`writing.changeCategories.${candidate.category}`)
                  : t("writing.changedText")}
              </strong>
              {candidate ? ` · ${t(`writing.changeSeverities.${candidate.severity}`)}` : ""}
            </p>
            <p>{candidate?.explanation ?? correction.summary}</p>
            {candidate?.uncertainty.level !== undefined &&
            candidate.uncertainty.level !== "none" ? (
              <p className={styles.warningText}>
                <CircleAlert aria-hidden="true" /> {candidate.uncertainty.explanation}
              </p>
            ) : null}
          </section>
          <Disclosure label={t("writing.sideBySide")}>
            <DiffView
              corrected={
                <AlignedPane
                  alignment={alignment}
                  onSelect={(changeId) => {
                    const segment = changes.find((item) => item.changeId === changeId);
                    if (segment) selectChange(segment);
                  }}
                  selectedId={selected?.changeId}
                  side="corrected"
                />
              }
              correctedLabel={t("writing.correctedText")}
              mode="side-by-side"
              original={
                <AlignedPane
                  alignment={alignment}
                  onSelect={(changeId) => {
                    const segment = changes.find((item) => item.changeId === changeId);
                    if (segment) selectChange(segment);
                  }}
                  selectedId={selected?.changeId}
                  side="original"
                />
              }
              originalLabel={t("writing.originalText")}
            />
          </Disclosure>
        </>
      ) : (
        <div className={styles.noChanges} role="status">
          <strong>{t("writing.noChanges")}</strong>
        </div>
      )}
      {correction.naturalAlternative ? (
        <Disclosure label={t("writing.naturalAlternative")}>
          <p>{correction.naturalAlternative}</p>
        </Disclosure>
      ) : null}
      {correction.vocabularyCandidates.length > 0 ? (
        <Disclosure
          label={t("writing.vocabularyCandidates", {
            count: correction.vocabularyCandidates.length,
          })}
        >
          <ItemList>
            {correction.vocabularyCandidates.map((item) => (
              <li key={`${item.lemma}-${item.sourceExcerpt}`}>
                <strong>{item.lemma}</strong> — {item.meaning}
                <Muted as="p">{item.rationale}</Muted>
              </li>
            ))}
          </ItemList>
        </Disclosure>
      ) : null}
      {correction.nextPracticeSuggestion ? (
        <Disclosure label={t("writing.nextPractice")}>
          <p>{correction.nextPracticeSuggestion}</p>
        </Disclosure>
      ) : null}
      {correction.overallUncertainty.level !== "none" || correction.caveats.length > 0 ? (
        <Disclosure label={t("writing.uncertaintyAndCaveats")}>
          {correction.overallUncertainty.level !== "none" ? (
            <p className={styles.warningText}>
              <CircleAlert aria-hidden="true" /> {correction.overallUncertainty.explanation}
            </p>
          ) : null}
          {correction.caveats.length > 0 ? (
            <ItemList>
              {correction.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ItemList>
          ) : null}
        </Disclosure>
      ) : null}
    </article>
  );
}

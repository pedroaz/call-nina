import { createElement } from "react";
import { BookOpen, Layers, Blocks, ListChecks, Mic, Headphones, PencilLine } from "lucide-react";
import styles from "./PracticeComposer.module.css";

export const activityIcons = {
  custom: ListChecks,
  flashcards: Layers,
  grammar: Blocks,
  reading: BookOpen,
  listening: Headphones,
  speaking: Mic,
  writing: PencilLine,
} as const;
export type PracticeKind = Exclude<keyof typeof activityIcons, "writing">;
export const practiceKinds: readonly PracticeKind[] = [
  "custom",
  "flashcards",
  "grammar",
  "reading",
  "listening",
  "speaking",
];
export function activityIcon(kind: string) {
  switch (kind) {
    case "flashcards":
    case "vocabulary-review":
      return activityIcons.flashcards;
    case "grammar":
      return activityIcons.grammar;
    case "reading":
      return activityIcons.reading;
    case "listening":
    case "codex-listening":
      return activityIcons.listening;
    case "speaking":
    case "voice-speaking":
      return activityIcons.speaking;
    case "writing":
      return activityIcons.writing;
    default:
      return activityIcons.custom;
  }
}
export function ActivityVisual({ kind }: { kind: string }) {
  const Icon = activityIcon(kind);
  return (
    <span className={styles.activityVisual} aria-hidden="true">
      {createElement(Icon)}
    </span>
  );
}

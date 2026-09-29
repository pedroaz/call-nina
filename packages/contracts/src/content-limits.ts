// Shared with the provider reader so portable exercises can retain its full output.
export const maximumStructuredOutputBytes = 512 * 1024;

// Envelope v1 has <24,000 free-text UTF-16 code units (including the material,
// learner goal and provenance), plus <16 KiB of keys, IDs and other fixed fields
// including 30 revision links. JSON needs at most six UTF-8 bytes per code unit
// (escaped controls/lone surrogates). This also covers candidate schema defaults.
const maximumContentEnvelopeBytes = 256 * 1024;
export const maximumExerciseContentBytes =
  maximumStructuredOutputBytes + maximumContentEnvelopeBytes;

// A materialized exercise retains at most the whole supported envelope's text.
// Added fields are bounded ASCII: 20 topic IDs (<2 KiB), provenance (<1 KiB),
// six content/exercise/material IDs (<1 KiB), 12 objective keys/wrappers,
// five hint wrappers, four option wrappers and the answer contract (<2 KiB).
// 16 KiB covers these additions without borrowing unused envelope capacity.
export const maximumMaterializedExerciseBytes = maximumExerciseContentBytes + 16 * 1024;
// schemaVersion, lifecycle, startedAt (24 ASCII characters) and exercise wrapper.
export const maximumExerciseSnapshotBytes = maximumMaterializedExerciseBytes + 128;
// History flattens fill-in-the-blank content with three underscores per blank.
export const maximumExerciseHistoryPromptCharacters = 4_000 + 20 * (3 + 4_000);

// attemptFeedback: 4,000 summary + 40 * 1,000 strengths/improvements + 1,000
// next step + 1,000 uncertainty code units at six bytes each, plus <32 KiB
// for 200 bounded IDs, source and JSON syntax. This also covers deterministic feedback.
export const maximumExerciseFeedbackBytes = 320 * 1024;
// History adds a reading title/passage (160 + 12,000), one answer (12,000),
// 12 objective evaluations (1,000 evidence + 1,000 uncertainty each), a suggested
// answer (12,000), feedback and <16 KiB of keys/enum values/JSON syntax.
export const maximumExerciseHistoryBytes =
  maximumExerciseSnapshotBytes +
  maximumExerciseFeedbackBytes +
  6 * (160 + 12_000 + 12_000 + 12 * (1_000 + 1_000) + 12_000) +
  16 * 1024;

// Vocabulary decks predate envelopes and had no whole-record byte cap. Preserve
// all 30 cards: lemma 160 + meaning 500 + morphology text 160 + 12 example pairs
// of 500 + 500 code units. Each card also has <1 KiB of JSON keys, syntax and
// enum values. Count the worst-case six-byte JSON escaping, not just ASCII.
const maximumFlashcardPayloadBytes = 30 * (6 * (160 + 500 + 160 + 12 * (500 + 500)) + 1024) + 2;
export const maximumFlashcardContentBytes =
  maximumFlashcardPayloadBytes + maximumContentEnvelopeBytes;

/** Browser-safe UTF-8 size, matching persistence's Buffer.byteLength(..., "utf8"). */
export function contentJsonByteLength(value: unknown): number {
  let bytes = 0;
  // Iterate code points without requiring Node or DOM globals in shared contracts.
  // JSON.stringify escapes lone surrogates, so every remaining pair is valid UTF-8.
  for (const character of JSON.stringify(value)) {
    const code = character.charCodeAt(0);
    bytes += character.length === 2 ? 4 : code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

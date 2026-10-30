// Local constrained decoding benefits from task fields preceding metadata.
// Only serialization order changes; shared contracts and teaching instructions remain authoritative.
export function localOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(localOutputSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, localOutputSchema(value)]),
  );
  const properties = result["properties"];
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return result;
  const fields = properties as Record<string, unknown>;
  const kind = fields["kind"];
  if (!kind || typeof kind !== "object") return result;
  const literal: unknown =
    "const" in kind
      ? kind.const
      : "enum" in kind && Array.isArray(kind.enum) && kind.enum.length === 1
        ? kind.enum[0]
        : undefined;
  const orders: Record<string, readonly string[]> = {
    "free-writing": ["kind", "prompt", "maximumCharacters"],
    "short-answer": ["kind", "acceptedAnswers", "question"],
    "fill-in-the-blank": ["kind", "leadingText", "blanks"],
    "sentence-correction": ["kind", "acceptedAnswers", "sentence"],
    "multiple-choice": ["kind", "question", "options", "correctOptionPosition"],
    "vocabulary-recall": ["kind", "direction", "acceptedAnswers", "cue"],
  };
  const order = typeof literal === "string" ? orders[literal] : undefined;
  if (order) {
    result["properties"] = Object.fromEntries(
      [
        ...order.filter((key) => key in fields),
        ...Object.keys(fields).filter((key) => !order.includes(key)),
      ].map((key) => [key, fields[key]]),
    );
  }
  return result;
}

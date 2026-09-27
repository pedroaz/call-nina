import * as z from "zod";

export { z };

export const boundarySurfaces = ["ipc", "mcp", "ai-output", "persisted-json", "fixture"] as const;

export const boundarySurfaceSchema = z.enum(boundarySurfaces);

export type BoundarySurface = z.infer<typeof boundarySurfaceSchema>;

export type RuntimeSchema<Output = unknown> = z.ZodType<Output> & {
  readonly __callNinaRuntimeSchema: true;
};

const ownedBoundarySchemas = new WeakSet<z.ZodType>();

export interface ValidationIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
}

export function strictBoundaryObject<const Shape extends z.ZodRawShape>(shape: Shape) {
  const schema = z.strictObject(shape);
  ownedBoundarySchemas.add(schema);
  return schema as typeof schema & RuntimeSchema<z.output<typeof schema>>;
}

export function boundaryUnion<
  const Options extends readonly [RuntimeSchema, RuntimeSchema, ...RuntimeSchema[]],
>(options: Options) {
  for (const schema of options) assertOwnedBoundarySchema(schema);
  const union = z.union(options);
  ownedBoundarySchemas.add(union);
  return union as typeof union & RuntimeSchema<z.output<(typeof options)[number]>>;
}

function assertOwnedBoundarySchema(schema: z.ZodType): asserts schema is RuntimeSchema {
  if (!ownedBoundarySchemas.has(schema)) {
    throw new Error("OD_BOUNDARY_SCHEMA_UNOWNED");
  }
}

export function parseBoundary<Schema extends RuntimeSchema>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  assertOwnedBoundarySchema(schema);
  return schema.parse(input);
}

export function safeParseBoundary<Schema extends RuntimeSchema>(
  schema: Schema,
  input: unknown,
): z.ZodSafeParseResult<z.output<Schema>> {
  assertOwnedBoundarySchema(schema);
  return schema.safeParse(input);
}

export function validationIssues(error: z.ZodError): readonly ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path
      .slice(0, 8)
      .map((segment) => (typeof segment === "number" ? segment : "<field>")),
  }));
}

export function toBoundaryJsonSchema(schema: RuntimeSchema) {
  assertOwnedBoundarySchema(schema);
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    cycles: "throw",
    unrepresentable: "throw",
  });
}

const unsupportedStructuredOutputKeywords = new Set(["$schema", "default"]);

function structuredOutputSubset(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredOutputSubset);
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (unsupportedStructuredOutputKeywords.has(key) || key === "prefixItems") continue;
    if (key === "const") {
      output["enum"] = [structuredOutputSubset(child)];
      continue;
    }
    output[key === "oneOf" ? "anyOf" : key] = structuredOutputSubset(child);
  }
  if (Array.isArray(source["prefixItems"]) && source["prefixItems"].length > 0) {
    const items = source["prefixItems"].map(structuredOutputSubset);
    output["items"] = items.every((item) => JSON.stringify(item) === JSON.stringify(items[0]))
      ? items[0]
      : { anyOf: items };
    output["minItems"] = items.length;
    output["maxItems"] = items.length;
  }
  return output;
}

export function toStructuredOutputJsonSchema(schema: RuntimeSchema) {
  return structuredOutputSubset(toBoundaryJsonSchema(schema));
}

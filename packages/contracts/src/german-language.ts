import { z } from "./schema-system.js";

export const germanArticleSchema = z.enum(["der", "die", "das"]);
export function germanNounGender(article: z.infer<typeof germanArticleSchema>) {
  return ({ der: "masculine", die: "feminine", das: "neuter" } as const)[
    germanArticleSchema.parse(article)
  ];
}

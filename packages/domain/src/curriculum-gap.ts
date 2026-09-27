import { strictBoundaryObject, z } from "@call-nina/contracts";

import { curriculumDomainSchema, type CurriculumManifest } from "./curriculum.js";
import { cefrBandSchema, type CefrBand } from "./learner-profile.js";

export const curriculumGapSelectionSchema = strictBoundaryObject({
  topicId: z.string().regex(/^curriculum-topic_[0-9a-z]{16,64}$/u),
  band: cefrBandSchema,
  domain: curriculumDomainSchema,
  summary: z.string().min(1).max(500).regex(/\S/u),
});

export type CurriculumGapSelection = z.infer<typeof curriculumGapSelectionSchema>;

const curriculumBands = ["a1", "a2", "b1", "b2"] as const;

export function selectNextCurriculumGap(
  manifest: CurriculumManifest,
  availableTopicIds: ReadonlySet<string>,
  options: { band?: CefrBand; domain?: string } = {},
): CurriculumGapSelection | null {
  for (const band of curriculumBands) {
    if (options.band !== undefined && options.band !== band) continue;
    for (const entry of manifest.bands[band]) {
      if (options.domain !== undefined && options.domain !== entry.domain) continue;
      if (availableTopicIds.has(entry.topicId)) continue;
      return curriculumGapSelectionSchema.parse({
        topicId: entry.topicId,
        band,
        domain: entry.domain,
        summary:
          "No lesson content is available for this topic; author it before selecting a disconnected lesson.",
      });
    }
  }
  return null;
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { curriculumManifestSchema, curriculumTopicFrontMatterSchema } from "@call-nina/domain";
import { readLearningCourse } from "@call-nina/persistence";
import { parse as parseYaml } from "yaml";

const thisFile = fileURLToPath(import.meta.url);

export async function readCurriculumInventory() {
  const configured = process.env["CALL_NINA_CURRICULUM_ROOT"];
  const root = configured
    ? path.resolve(configured)
    : path.resolve(path.dirname(thisFile), "../../../content/curriculum");
  const parsed: unknown = parseYaml(
    await readFile(path.join(root, "manifest.yaml"), "utf8"),
  ) as unknown;
  const manifest = curriculumManifestSchema.parse(parsed);
  const course = await readLearningCourse(root);
  const entries = Object.values(manifest.bands).flat();
  const topicIds = new Set(entries.map((entry) => entry.topicId));
  const availableTopicIds = new Set<string>();
  for (const unit of course?.units ?? []) {
    for (const id of unit.curriculumTopicIds) {
      if (!topicIds.has(id)) throw new Error("OD_CURRICULUM_TOPIC_INVALID");
      availableTopicIds.add(id);
    }
  }
  for (const entry of entries) {
    const source = await readFile(path.join(root, entry.path), "utf8");
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)?.[1];
    if (!frontMatter) throw new Error("OD_CURRICULUM_TOPIC_INVALID");
    const topic = curriculumTopicFrontMatterSchema.parse(parseYaml(frontMatter));
    if (topic.topicId !== entry.topicId || topic.domain !== entry.domain) {
      throw new Error("OD_CURRICULUM_TOPIC_INVALID");
    }
    if (topic.lessonFoundation) availableTopicIds.add(topic.topicId);
  }
  return { manifest, availableTopicIds };
}

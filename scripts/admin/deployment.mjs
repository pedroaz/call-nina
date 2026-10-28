import { output } from "./configuration.mjs";
import { workflowUrl } from "../ci/common.mjs";

export async function deploy() {
  output({
    deployed: false,
    workflowUrl,
    next: "Run Release in GitHub Actions with target hosting or all and operation publish. Local publication is retired.",
  });
}

import { output } from "./configuration.mjs";
import { deployUrl } from "../ci/common.mjs";

export async function deploy() {
  output({
    deployed: false,
    workflowUrl: deployUrl,
    next: "Run Deploy Vercel in GitHub Actions from main to build and deploy the combined website/API. No desktop build is required.",
  });
}

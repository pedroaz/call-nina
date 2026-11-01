import { environment, output } from "./configuration.mjs";
import { deployUrl } from "../ci/common.mjs";

export async function deploy() {
  output({
    deployed: false,
    environment,
    workflowUrl: deployUrl,
    next: `Run Deploy Vercel in GitHub Actions with environment=${environment}. Prd requires main; dev accepts working branches. No desktop build is required.`,
  });
}

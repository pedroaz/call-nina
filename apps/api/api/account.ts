import { accountResponse, unavailableResponse } from "@call-nina/managed-generation/server";
import { accountDeployment, accountSql, selectedDeployment } from "../deployment.js";

export async function GET(request: Request): Promise<Response> {
  try {
    const deployment = accountDeployment(process.env);
    if (
      !deployment ||
      new URL(request.url).origin !== deployment.origin ||
      new URL(request.url).search
    )
      return unavailableResponse();
    return await accountResponse(
      request,
      deployment.auth,
      accountSql(),
      selectedDeployment(process.env)?.policy ?? null,
      process.env["NINA_SPEECH_ENABLED"] === "true" &&
        process.env["NINA_SPEECH_RECOVERY_READY"] === "true" &&
        Boolean(process.env["NINA_SPEECH_GOOGLE_CREDENTIALS"]),
    );
  } catch {
    return unavailableResponse();
  }
}

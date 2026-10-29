import { speechResponse } from "@call-nina/managed-generation/speech";
import { unavailableResponse } from "@call-nina/managed-generation/server";
import { accountDeployment, accountSql } from "../deployment.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const deployment = accountDeployment(process.env);
    const key = process.env["NINA_SPEECH_GOOGLE_CREDENTIALS"];
    const throttleKey = process.env["NINA_STARTER_THROTTLE_HMAC_KEY"];
    const address = request.headers.get("x-vercel-forwarded-for");
    if (
      !deployment ||
      new URL(request.url).origin !== deployment.origin ||
      new URL(request.url).search ||
      process.env["NINA_SPEECH_ENABLED"] !== "true" ||
      process.env["NINA_SPEECH_RECOVERY_READY"] !== "true" ||
      !key ||
      !throttleKey ||
      !address
    )
      return unavailableResponse();
    return await speechResponse(request, {
      auth: deployment.auth,
      sql: accountSql(),
      key,
      throttleKey,
      address,
    });
  } catch {
    return unavailableResponse();
  }
}

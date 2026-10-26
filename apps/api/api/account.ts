import { accountResponse, unavailableResponse } from "@call-nina/managed-generation/server";
import { accountDeployment, accountSql } from "../deployment.js";

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
      deployment.inferenceEnabled,
    );
  } catch {
    return unavailableResponse();
  }
}

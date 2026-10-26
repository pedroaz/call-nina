import {
  ManagedService,
  openBudgetSql,
  unavailableResponse,
} from "@call-nina/managed-generation/server";
import { selectedDeployment, accountDeployment } from "../deployment.js";

// Selected combined website/API Vercel project only. No generic HTTP listener or localhost header
// trust; environment identity is server configuration, never a request header.
// Vercel overwrites x-forwarded-for at ingress; use its protected twin:
// https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
let active: { service: ManagedService; origin: string } | undefined;
export async function POST(request: Request): Promise<Response> {
  try {
    const deployment = selectedDeployment(process.env);
    const account = accountDeployment(process.env);
    if (!account) return unavailableResponse();
    if (!deployment) return unavailableResponse();
    if (new URL(request.url).origin !== deployment.origin) return unavailableResponse();
    const address = request.headers.get("x-vercel-forwarded-for");
    if (!address) return unavailableResponse();
    if (!active) {
      const apiKey = process.env["NINA_STARTER_GATEWAY_API_KEY"];
      const throttleKey = process.env["NINA_STARTER_THROTTLE_HMAC_KEY"];
      const connectionString = process.env["NINA_STARTER_DATABASE_URL"];
      if (!apiKey || !throttleKey || !connectionString) return unavailableResponse();
      const sql = openBudgetSql(connectionString);
      active = {
        origin: deployment.origin,
        service: new ManagedService({
          auth: account.auth,
          policy: deployment.policy,
          sql,
          apiKey,
          throttleKey,
        }),
      };
    }
    if (active.origin !== deployment.origin) return unavailableResponse();
    return await active.service.handle(request, address);
  } catch {
    return unavailableResponse();
  }
}

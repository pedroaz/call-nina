import { timingSafeEqual } from "node:crypto";
import { accountDeployment, accountSql } from "../deployment.js";

export async function GET(request: Request): Promise<Response> {
  const deployment = accountDeployment(process.env);
  const secret = process.env["CRON_SECRET"];
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (
    !deployment ||
    new URL(request.url).origin !== deployment.origin ||
    new URL(request.url).search ||
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return new Response(null, { status: 404 });
  try {
    await accountSql().query("SELECT nina_speech.expire()", []);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}

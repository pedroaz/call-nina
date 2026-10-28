import { verifyToken } from "@clerk/backend";
import { ManagedFailure } from "./protocol.js";

export type ClerkPolicy = { secretKey: string; issuer: string; authorizedParties: string[] };
export async function authenticate(
  request: Request,
  policy: ClerkPolicy,
  options: { allowNativeBearer?: boolean } = {},
): Promise<string> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 16007)
    throw new ManagedFailure("unauthenticated");
  try {
    const claims = await verifyToken(authorization.slice(7), {
      secretKey: policy.secretKey,
      ...(options.allowNativeBearer ? {} : { authorizedParties: policy.authorizedParties }),
    });
    // Native Clerk sessions may omit azp. Only bearer-only sync admits those;
    // any supplied origin must still match the configured renderer origins.
    if (claims.azp !== undefined && !policy.authorizedParties.includes(claims.azp))
      throw new Error("invalid-party");
    if (claims.iss !== policy.issuer || !claims.sub || !claims.sid || claims.sts === "pending")
      throw new Error("invalid-session");
    return claims.sub;
  } catch {
    throw new ManagedFailure("unauthenticated");
  }
}

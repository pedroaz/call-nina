import { verifyToken } from "@clerk/backend";
import { ManagedFailure } from "./protocol.js";

export type ClerkPolicy = { secretKey: string; issuer: string; authorizedParties: string[] };
export async function authenticate(request: Request, policy: ClerkPolicy): Promise<string> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 16007)
    throw new ManagedFailure("unauthenticated");
  try {
    const claims = await verifyToken(authorization.slice(7), {
      secretKey: policy.secretKey,
      authorizedParties: policy.authorizedParties,
    });
    if (claims.iss !== policy.issuer || !claims.sub || !claims.sid || claims.sts === "pending")
      throw new Error("invalid-session");
    return claims.sub;
  } catch {
    throw new ManagedFailure("unauthenticated");
  }
}

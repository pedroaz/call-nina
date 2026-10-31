import { z } from "@call-nina/contracts";
import { createPublicKey, verify } from "node:crypto";
import { authOrigin, equal, jsonRequest } from "./http.js";

export async function validateIdentity(
  token: string,
  clientId: string,
  nonce: string,
  signal: AbortSignal,
) {
  const parts = token.split(".");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (parts.length !== 3 || !encodedHeader || !encodedClaims || !encodedSignature)
    throw new Error("OD_CHATGPT_ID_TOKEN_INVALID");
  const header = z
    .object({ alg: z.literal("RS256"), kid: z.string(), crit: z.never().optional() })
    .parse(JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")));
  const discovery = z
    .object({ issuer: z.literal(authOrigin), jwks_uri: z.url() })
    .parse(await jsonRequest(`${authOrigin}/.well-known/openid-configuration`, { signal }));
  if (new URL(discovery.jwks_uri).origin !== authOrigin)
    throw new Error("OD_CHATGPT_ISSUER_INVALID");
  const keys = z
    .object({
      keys: z
        .array(
          z
            .object({
              kid: z.string().optional(),
              kty: z.string(),
              use: z.string().optional(),
              alg: z.string().optional(),
            })
            .loose(),
        )
        .max(100),
    })
    .parse(await jsonRequest(discovery.jwks_uri, { signal }))
    .keys.filter(
      (key) =>
        key.kid === header.kid &&
        key.kty === "RSA" &&
        (!key.use || key.use === "sig") &&
        (!key.alg || key.alg === "RS256"),
    );
  const signingKey = keys[0];
  if (
    keys.length !== 1 ||
    !signingKey ||
    !verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key: signingKey, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    )
  )
    throw new Error("OD_CHATGPT_ID_TOKEN_SIGNATURE_INVALID");
  const claims = z
    .object({
      iss: z.literal(authOrigin),
      aud: z.union([z.string(), z.array(z.string()).min(1)]),
      azp: z.string().optional(),
      sub: z.string().min(1).max(512),
      exp: z.number(),
      iat: z.number(),
      nbf: z.number().optional(),
      nonce: z.string(),
      email: z.string().max(320).optional(),
    })
    .parse(JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")));
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  const now = Date.now() / 1000;
  if (
    !audiences.includes(clientId) ||
    (audiences.length > 1 && claims.azp !== clientId) ||
    (claims.azp !== undefined && claims.azp !== clientId) ||
    claims.exp <= now ||
    claims.iat > now + 5 ||
    (claims.nbf !== undefined && claims.nbf > now + 5) ||
    !equal(claims.nonce, nonce)
  )
    throw new Error("OD_CHATGPT_ID_TOKEN_CLAIMS_INVALID");
  return claims;
}

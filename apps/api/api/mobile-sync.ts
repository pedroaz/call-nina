import { createHash } from "node:crypto";
import { authenticate } from "@call-nina/managed-generation/server";
import {
  mobileRequestSchema,
  mobileManifestSchema,
  mobileSnapshotSchema,
  mobileChunkBytes,
  z,
} from "@call-nina/contracts";
import { accountDeployment, mobileSql } from "../deployment.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
async function readBody(request: Request) {
  const limit = 1_500_000;
  if (Number(request.headers.get("content-length")) > limit) throw new Error("large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return mobileRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
export async function handle(request: Request): Promise<Response> {
  const deployment = accountDeployment(process.env);
  if (!deployment || new URL(request.url).origin !== deployment.origin)
    return json({ error: "unavailable" }, 503);
  let uid: string;
  try {
    uid = await authenticate(request, deployment.auth, { allowNativeBearer: true });
  } catch {
    return json({ error: "unauthenticated" }, 401);
  }
  const exchange = async (input: unknown) => {
    // Bind as text: postgres.js serializes jsonb parameters itself, which would
    // double-encode the JSON string required by the shared SQL transport.
    const result = await mobileSql().query("select nina_sync.exchange($1,$2::text::jsonb) as result", [
      uid,
      JSON.stringify(input),
    ]);
    const value = z.object({ result: z.unknown() }).parse(result.rows[0]).result;
    if (value && typeof value === "object" && "error" in value)
      throw new Error(String(value.error));
    return value;
  };
  try {
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if (!params.size) return json(await exchange({ action: "manifest" }));
      if (params.size !== 2 || !params.has("id") || !params.has("index"))
        return json({ error: "invalid" }, 400);
      const id = z.uuid().parse(params.get("id"));
      const index = z.coerce.number().int().min(0).max(99).parse(params.get("index"));
      return json(await exchange({ action: "read", id, index }));
    }
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
    if (new URL(request.url).search) return json({ error: "invalid" }, 400);
    const input = await readBody(request);
    if (input.action === "begin") return json(await exchange({ ...input, id: input.manifest.id }));
    if (input.action === "chunk") {
      const manifest = mobileManifestSchema.parse(
        await exchange({ action: "metadata", id: input.id }),
      );
      const bytes = Buffer.from(input.data, "base64");
      if (
        bytes.toString("base64") !== input.data ||
        bytes.length !==
          Math.min(mobileChunkBytes, manifest.byteLength - input.index * mobileChunkBytes) ||
        hash(bytes) !== manifest.chunkHashes[input.index]
      )
        return json({ error: "invalid" }, 400);
      return json(await exchange(input));
    }
    const staged = z
      .object({
        manifest: mobileManifestSchema,
        chunks: z.array(z.object({ index: z.number(), data: z.string() })),
      })
      .parse(await exchange({ action: "inspect", id: input.id }));
    if (staged.chunks.length !== staged.manifest.chunkHashes.length)
      return json({ error: "conflict" }, 409);
    const chunks = staged.chunks.map((chunk, index) => {
      const bytes = Buffer.from(chunk.data, "base64");
      if (
        chunk.index !== index ||
        bytes.length !==
          Math.min(mobileChunkBytes, staged.manifest.byteLength - index * mobileChunkBytes) ||
        hash(bytes) !== staged.manifest.chunkHashes[index]
      )
        throw new Error("invalid");
      return bytes;
    });
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== staged.manifest.byteLength || hash(bytes) !== staged.manifest.sha256)
      throw new Error("invalid");
    mobileSnapshotSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return json(await exchange({ action: "publish", id: input.id }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "unavailable";
    const status =
      code === "large"
        ? 413
        : code === "changed" || code === "conflict"
          ? 409
          : code === "throttled"
            ? 429
            : code === "invalid" || error instanceof z.ZodError
              ? 400
              : 503;
    return json(
      {
        error:
          status === 503
            ? "unavailable"
            : status === 413
              ? "too-large"
              : status === 409
                ? "changed"
                : status === 429
                  ? "throttled"
                  : "invalid",
      },
      status,
    );
  }
}

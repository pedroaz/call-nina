import path from "node:path";
import { constants } from "node:fs";
import { rename } from "node:fs/promises";
import { regular, removeFile, writeNew, atomic } from "@call-nina/offline-runtime/files";
import type { SpeechArtifact } from "./catalog.js";
import type { prepareDownload } from "@call-nina/offline-runtime/download";

// Same committed-prefix/checkpoint format as the HTTPS downloader. Local staging
// is an explicit development input, never another accepted network origin.
export async function copyLocalArtifact(
  source: string,
  root: string,
  artifact: SpeechArtifact,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  prepared: Awaited<ReturnType<typeof prepareDownload>>,
) {
  progress(prepared.bytes);
  if (prepared.complete) return;
  const final = path.join(root, artifact.file);
  const part = `${final}.part`;
  const checkpoint = `${final}.resume`;
  const input = await regular(source);
  let output;
  try {
    if ((await input.stat()).size !== artifact.bytes) throw new Error("OD_SPEECH_INTEGRITY");
    if (prepared.bytes === 0) {
      await writeNew(part, "").catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      });
      await atomic(checkpoint, {
        sha256: artifact.sha256,
        bytes: 0,
        prefix: prepared.hash.copy().digest("hex"),
      });
    }
    output = await regular(part, constants.O_WRONLY);
    if ((await output.stat()).size !== prepared.bytes) throw new Error("OD_SPEECH_INTEGRITY");
    const buffer = Buffer.alloc(8 * 1024 ** 2);
    let bytes = prepared.bytes;
    while (bytes < artifact.bytes) {
      signal.throwIfAborted();
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, artifact.bytes - bytes),
        bytes,
      );
      if (!bytesRead) throw new Error("OD_SPEECH_INTEGRITY");
      let written = 0;
      while (written < bytesRead) {
        signal.throwIfAborted();
        const result = await output.write(buffer, written, bytesRead - written, bytes + written);
        if (!result.bytesWritten) throw new Error("OD_SPEECH_INTEGRITY");
        written += result.bytesWritten;
      }
      prepared.hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
      await output.sync();
      await atomic(checkpoint, {
        sha256: artifact.sha256,
        bytes,
        prefix: prepared.hash.copy().digest("hex"),
      });
      progress(bytes);
    }
    if (prepared.hash.digest("hex") !== artifact.sha256) throw new Error("OD_SPEECH_INTEGRITY");
    signal.throwIfAborted();
  } finally {
    await input.close();
    await output?.close();
  }
  await rename(part, final);
  await removeFile(checkpoint);
}

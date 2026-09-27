import net from "node:net";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { inspectOwnedProcess } from "./lifecycle.mjs";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
export const verificationRoot = path.join(repositoryRoot, ".runtime", "verification");
export const socketPath = path.join(verificationRoot, "control.sock");
export async function requestVerification(request) {
  try {
    return await send(request);
  } catch (error) {
    throw new Error(
      /^VERIFY_[A-Z0-9_:]+$/.test(error?.message ?? "")
        ? error.message
        : "VERIFY_SESSION_UNAVAILABLE",
    );
  }
}
async function send(request) {
  const state = JSON.parse(
    await readFile(path.join(repositoryRoot, ".runtime/verify.json"), "utf8"),
  );
  if (!(await inspectOwnedProcess(state)).owned) throw new Error("VERIFY_OWNER_UNAVAILABLE");
  const directory = await lstat(verificationRoot);
  const socket = await lstat(socketPath);
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid() ||
    directory.mode & 0o077 ||
    !socket.isSocket() ||
    socket.uid !== process.getuid() ||
    socket.mode & 0o077
  )
    throw new Error("VERIFY_SOCKET_UNSAFE");
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let output = "";
    connection.setEncoding("utf8");
    connection.setTimeout(300000, () => connection.destroy(new Error("VERIFY_REQUEST_TIMEOUT")));
    connection.on("connect", () => connection.write(JSON.stringify(request) + "\n"));
    connection.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 2 * 1024 * 1024)
        connection.destroy(new Error("VERIFY_RESPONSE_LIMIT"));
      if (output.includes("\n")) {
        connection.end();
        try {
          const response = JSON.parse(output.slice(0, output.indexOf("\n")));
          if (!response.ok) {
            const phase =
              typeof response.phase === "string"
                ? response.phase.toUpperCase().replaceAll("-", "_")
                : "";
            reject(new Error(`${response.code}${/^[A-Z_]+$/.test(phase) ? `:${phase}` : ""}`));
          } else resolve(response.result);
        } catch {
          reject(new Error("VERIFY_RESPONSE_INVALID"));
        }
      }
    });
    connection.on("error", () => reject(new Error("VERIFY_CONNECTION_FAILED")));
    connection.on("end", () => {
      if (!output.includes("\n")) reject(new Error("VERIFY_CONNECTION_CLOSED"));
    });
  });
}

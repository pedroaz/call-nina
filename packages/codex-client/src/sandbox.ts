import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const prefix = "call-nina-app-server-turn-";
const markerName = ".call-nina-owned-turn.json";
const trustedTemporaryParents =
  process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp", "/var/tmp"];
const ownedPolicies = new WeakSet<object>();

export type OwnedSandboxPolicy = Readonly<{
  sandboxRoot: string;
  workspaceRoot: string;
  approvalPolicy: "never";
  sandboxPolicy: Readonly<{
    type: "workspaceWrite";
    writableRoots: readonly [string];
    networkAccess: false;
  }>;
}>;

export type OwnedTurnSandbox = Readonly<{
  policy: OwnedSandboxPolicy;
  cleanup(): Promise<void>;
}>;

function containsPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalizeIfPresent(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

async function chooseTemporaryParent(forbiddenRoots: readonly string[]): Promise<string> {
  const forbidden = await Promise.all(forbiddenRoots.map(canonicalizeIfPresent));
  for (const candidate of trustedTemporaryParents) {
    try {
      const canonical = await realpath(candidate);
      const metadata = await stat(canonical);
      if (
        metadata.isDirectory() &&
        canonical !== path.parse(canonical).root &&
        !forbidden.some((root) => containsPath(root, canonical) || containsPath(canonical, root))
      ) {
        return canonical;
      }
    } catch {
      // Continue to the next fixed system temporary parent.
    }
  }
  throw new Error("OD_APP_SERVER_TEMP_ROOT_UNAVAILABLE");
}

async function mintPolicy(sandboxRoot: string, workspaceRoot: string): Promise<OwnedSandboxPolicy> {
  const [canonicalSandbox, canonicalWorkspace] = await Promise.all([
    realpath(sandboxRoot),
    realpath(workspaceRoot),
  ]);
  const relative = path.relative(canonicalSandbox, canonicalWorkspace);
  if (
    canonicalSandbox === path.parse(canonicalSandbox).root ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("OD_APP_SERVER_SANDBOX_INVALID");
  }
  const writableRoots = Object.freeze([canonicalWorkspace] as const);
  const policy = Object.freeze({
    sandboxRoot: canonicalSandbox,
    workspaceRoot: canonicalWorkspace,
    approvalPolicy: "never" as const,
    sandboxPolicy: Object.freeze({
      type: "workspaceWrite" as const,
      writableRoots,
      networkAccess: false as const,
    }),
  });
  ownedPolicies.add(policy);
  return policy;
}

export async function createOwnedTurnSandbox(options: {
  forbiddenRoots: readonly string[];
}): Promise<OwnedTurnSandbox> {
  const temporaryParent = await chooseTemporaryParent(options.forbiddenRoots);
  const runId = randomUUID();
  const sandboxRoot = await mkdtemp(path.join(temporaryParent, prefix));
  const workspaceRoot = path.join(sandboxRoot, "workspace");
  const markerPath = path.join(sandboxRoot, markerName);
  let policy: OwnedSandboxPolicy | undefined;
  try {
    await mkdir(workspaceRoot, { mode: 0o700 });
    await writeFile(markerPath, `${JSON.stringify({ runId })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    policy = await mintPolicy(sandboxRoot, workspaceRoot);
    let retired = false;
    return Object.freeze({
      policy,
      async cleanup() {
        if (retired) return;
        ownedPolicies.delete(policy as object);
        retired = true;
        const marker: unknown = JSON.parse(await readFile(markerPath, "utf8"));
        if (
          typeof marker !== "object" ||
          marker === null ||
          !("runId" in marker) ||
          marker.runId !== runId ||
          path.dirname(sandboxRoot) !== temporaryParent ||
          !path.basename(sandboxRoot).startsWith(prefix)
        ) {
          throw new Error("OD_APP_SERVER_SANDBOX_OWNERSHIP_INVALID");
        }
        await rm(sandboxRoot, { recursive: true });
      },
    });
  } catch (error) {
    if (policy) ownedPolicies.delete(policy);
    if (
      path.dirname(sandboxRoot) === temporaryParent &&
      path.basename(sandboxRoot).startsWith(prefix)
    ) {
      await rm(sandboxRoot, { recursive: true });
    }
    throw error;
  }
}

export function assertOwnedSandboxPolicy(policy: unknown): OwnedSandboxPolicy {
  if (typeof policy !== "object" || policy === null || !ownedPolicies.has(policy)) {
    throw new Error("OD_APP_SERVER_SANDBOX_POLICY_INVALID");
  }
  const candidate = policy as Record<string, unknown>;
  const sandboxPolicy = candidate["sandboxPolicy"];
  if (typeof sandboxPolicy !== "object" || sandboxPolicy === null) {
    throw new Error("OD_APP_SERVER_SANDBOX_POLICY_INVALID");
  }
  const sandboxRecord = sandboxPolicy as Record<string, unknown>;
  const workspaceRoot = candidate["workspaceRoot"];
  const writableRoots = sandboxRecord["writableRoots"];
  if (
    typeof workspaceRoot !== "string" ||
    !Object.isFrozen(candidate) ||
    candidate["approvalPolicy"] !== "never" ||
    sandboxRecord["type"] !== "workspaceWrite" ||
    sandboxRecord["networkAccess"] !== false ||
    !Array.isArray(writableRoots) ||
    writableRoots.length !== 1 ||
    writableRoots[0] !== workspaceRoot ||
    Object.keys(sandboxRecord).some(
      (key) => !["type", "writableRoots", "networkAccess"].includes(key),
    )
  ) {
    throw new Error("OD_APP_SERVER_SANDBOX_POLICY_INVALID");
  }
  return policy as OwnedSandboxPolicy;
}

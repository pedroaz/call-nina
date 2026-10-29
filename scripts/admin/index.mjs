import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pnpmCommand } from "../lib/package-command.mjs";
import { commands, help } from "./commands.mjs";
import { ControlError, config, root, output, results, configureClient } from "./configuration.mjs";
import { loadCredentials, credentialStatus } from "./credentials.mjs";
import { saveSecrets, legacyImport, childEnvironment } from "./credentials.mjs";
import { confirm, ReviewComplete, executionReview } from "./review.mjs";
let built = false;
function build() {
  if (built) return;
  const child = spawnSync(...pnpmCommand(["--filter", "@call-nina/api...", "run", "build"]), {
    cwd: root,
    stdio: ["ignore", 2, 2],
    env: childEnvironment(),
  });
  if (child.error || child.status !== 0)
    throw new ControlError("API dependencies could not be built");
  built = true;
}
async function execute(tokens) {
  const yes = tokens.includes("--yes");
  const args = tokens.filter((token) => token !== "--yes");
  const definition = commands.find((command) =>
    command.name.split(" ").every((word, index) => word === args[index]),
  );
  if (!definition)
    throw new ControlError("Unknown admin command; use node scripts/admin/index.mjs help");
  const values = args.slice(definition.name.split(" ").length);
  if (
    values.length < definition.args.filter((arg) => !arg.endsWith("?")).length ||
    values.length > definition.args.length ||
    values.some((value) => value.startsWith("--"))
  )
    throw new ControlError(`Usage: ${definition.name} ${definition.args.join(" ")}`);
  const name = definition.name;
  if (!["infra plan", "infra configure-client"].includes(name)) await loadCredentials();
  if (name === "credentials status") return output(credentialStatus());
  if (name === "credentials import") {
    const incoming = await legacyImport();
    await confirm(
      {
        operation: name,
        names: Object.keys(incoming),
        destination: "root .env",
        originalRetained: true,
      },
      yes,
    );
    await saveSecrets(incoming);
    return output({ imported: Object.keys(incoming) });
  }
  if (name === "infra clerk-link") return (await import("./clerk-setup.mjs")).linkExisting(yes);
  if (["infra clerk-inspect", "infra clerk-apply"].includes(name)) {
    const clerk = await import("./clerk-instance.mjs");
    if (name === "infra clerk-inspect") return output(await clerk.inspectClerk());
    return clerk.applyClerk(yes);
  }
  if (name === "infra database-connect")
    return (await import("./database-config.mjs")).connectExisting();
  build();
  const infra = await import("./infrastructure.mjs");
  const target = {
    environment: "production",
    clerkInstanceId: config.clerkInstanceId,
    vercelProjectId: config.projectId,
    database: "Existing Marketplace database from root .env (values withheld)",
  };
  if (name === "infra plan") return output(await infra.plan());
  if (name === "infra inspect") return output(await infra.inspect());
  if (name === "infra apply") {
    const diff = await infra.inspect();
    if (diff.missing.length)
      throw new ControlError(`Missing configuration: ${diff.missing.join(", ")}`);
    await confirm({ operation: name, ...diff }, yes);
    return infra.apply(diff);
  }
  if (name === "infra database-check") return (await import("./database.mjs")).checkDatabase();
  if (name.startsWith("infra ") || name === "deploy") {
    const details =
      name === "infra migrate"
        ? {
            migrations: [
              "001-budget.sql",
              "002-accounts.sql",
              "003-ai-access.sql",
              "004-mobile-sync.sql",
              "005-speech.sql",
              "006-account-tiers.sql",
            ],
            operation: "Check supplied PG role permissions and apply missing migrations only",
          }
        : name === "infra runtime-setup"
          ? {
              runtimeRole: config.runtimeRole,
              operation:
                "Check role-management permissions; generate/reuse a separate runtime password; create/reconcile only Nina's restricted role",
            }
          : name === "infra configure-client"
            ? {
                operation: "Generate public desktop and API configuration",
                origin: config.origin,
              }
            : { operation: "Show manual GitHub hosting publication instructions (no upload)" };
    await confirm({ command: name, target, ...details, inferenceActivated: false }, yes);
    if (name === "infra runtime-setup") return (await import("./runtime-role.mjs")).setupRuntime();
    if (name === "infra migrate") return (await import("./database.mjs")).migrate();
    if (name === "infra configure-client") return configureClient();
    return (await import("./deployment.mjs")).deploy();
  }
  if (name === "users reset-beta")
    return (await import("./beta-reset.mjs")).resetBeta(values[0], yes);
  const { findUser, positive, passwordOperation, changeAccess } = await import("./users.mjs");
  const { topup, report } = await import("./usage.mjs");
  const { database } = await import("./database.mjs");
  const [username] = values;
  if (name === "users set-tier" && !["free", "plus"].includes(values[1]))
    throw new ControlError("Tier must be free or plus");
  const actions = ["users onboard", "quota top-up", "speech grant"].includes(name)
    ? positive(values[1])
    : undefined;
  if (actions && yes && !values[2])
    throw new ControlError(
      "Execution requires the grant UUID from the review; reuse it for retries",
    );
  const grantId = actions ? (values[2] ?? randomUUID()) : undefined;
  if (grantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantId))
    throw new ControlError("Invalid grant UUID");
  let user = await findUser(username);
  if (["users create", "users onboard"].includes(name) && user)
    throw new ControlError("User already exists; use individual operations to continue");
  if (!["users create", "users onboard"].includes(name) && !user)
    throw new ControlError("User not found");
  if (name === "usage") return report(user, username);
  if (name === "speech usage") return (await import("./speech.mjs")).speechAdmin(name, user);
  await confirm(
    {
      operation: name,
      target,
      username,
      userId: user?.id,
      actions,
      ...(name === "users set-tier" ? { tier: values[1], grants: "none" } : {}),
      grantId,
      ...(grantId
        ? {
            retry: `node scripts/admin/index.mjs ${name === "speech grant" ? "speech grant" : "quota top-up"} ${username} ${actions} ${grantId}`,
          }
        : {}),
      ...(name === "users onboard"
        ? { steps: ["create user", "assign Plus", "grant initial actions"] }
        : {}),
    },
    yes,
  );
  if (name === "users set-tier") {
    await (await import("./users.mjs")).setTier(user, values[1]);
    return report(user, username);
  }
  if (name.startsWith("speech "))
    return (await import("./speech.mjs")).speechAdmin(name, user, actions, grantId);
  if (name === "users onboard") {
    const completed = [];
    let password;
    try {
      ({ user, password } = await passwordOperation(username, "create", user));
      completed.push("create");
      await (await import("./users.mjs")).setTier(user, "plus");
      completed.push("enable-ai");
      await database((sql) => topup(sql, user.id, actions, grantId));
      completed.push("top-up");
      output({ username, userId: user.id, password, completed, grantId });
    } catch {
      output({
        username,
        userId: user?.id,
        password,
        completed,
        uncertainOrPending: ["create", "enable-ai", "top-up"].filter(
          (step) => !completed.includes(step),
        ),
        grantId,
        note: "Inspect remote state before continuing with individual commands; do not repeat onboarding. Reuse grantId for a top-up retry.",
      });
      throw new ControlError("Onboarding stopped; partial results retained");
    }
    return;
  }
  if (["users create", "users reset-password"].includes(name)) {
    const credentials = await passwordOperation(username, name.split(" ")[1], user);
    return output({
      username,
      userId: credentials.user.id,
      password: credentials.password,
      completed: name,
    });
  }
  if (name === "quota top-up") await database((sql) => topup(sql, user.id, actions, grantId));
  else await changeAccess(user, name.split(" ")[1]);
  output({ completed: name, username, userId: user.id, ...(grantId ? { grantId } : {}) });
  return report(user, username);
}
let response;
try {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "help" || args[0] === "--help") {
    if (args.length > 1) throw new ControlError("Help accepts no arguments");
    output(help());
  } else await execute(args);
  response = { status: "completed", results };
} catch (error) {
  if (error instanceof ReviewComplete) response = { status: "review", review: error.review };
  else {
    response = {
      status: "error",
      error:
        error instanceof ControlError
          ? error.message
          : "Admin operation failed; private provider details withheld",
      results,
      ...(executionReview
        ? {
            operation: executionReview,
            recovery:
              "Execution started. Results record confirmed steps; remaining writes may be uncertain. Inspect state before retrying; reuse any grant UUID.",
          }
        : {}),
    };
    process.exitCode = 1;
  }
}
process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);

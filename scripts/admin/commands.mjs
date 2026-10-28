// Operation metadata drives agent discovery and argument validation.
export const commands = [
  {
    name: "users onboard",
    category: "Users",
    label: "Create, enable hosted AI and grant initial actions (live write)",
    args: ["USERNAME", "ACTIONS", "GRANT_UUID?"],
    mutation: true,
  },
  ...["create", "reset-password", "enable-ai", "disable-ai"].map((action) => ({
    name: `users ${action}`,
    category: "Users",
    label: {
      create: "Create a Clerk user (live write; no allowance)",
      "reset-password": "Reset a user password (live write)",
      "enable-ai": "Enable hosted AI (live write)",
      "disable-ai": "Disable hosted AI (live write)",
    }[action],
    args: ["USERNAME"],
    mutation: true,
  })),
  {
    name: "quota top-up",
    category: "Allowances and usage",
    label: "Add AI actions (live write)",
    args: ["USERNAME", "ACTIONS", "GRANT_UUID?"],
    mutation: true,
  },
  {
    name: "usage",
    category: "Allowances and usage",
    label: "Inspect usage (live read)",
    args: ["USERNAME"],
  },
  {
    name: "credentials status",
    category: "Credentials",
    label: "Show credential presence and source (local; values hidden)",
    args: [],
  },
  {
    name: "credentials import",
    category: "Credentials",
    label: "Import legacy credentials into .env (local write)",
    args: [],
    mutation: true,
  },
  {
    name: "infra clerk-link",
    category: "Infrastructure",
    label: "Link existing Clerk instance (live read; saves local configuration)",
    args: [],
    mutation: true,
  },
  ...["inspect", "apply"].map((action) => ({
    name: `infra clerk-${action}`,
    category: "Infrastructure",
    label: {
      inspect: "Inspect Clerk policy through APIs (live read; no build)",
      apply: "Review and reconcile Clerk policy only (API dry run; --yes writes)",
    }[action],
    args: [],
    mutation: action === "apply",
  })),
  ...[
    "plan",
    "inspect",
    "apply",
    "database-connect",
    "database-check",
    "migrate",
    "runtime-setup",
    "configure-client",
  ].map((action) => ({
    name: `infra ${action}`,
    category: "Infrastructure",
    label: {
      plan: "Show setup prerequisites and intended changes (local)",
      inspect: "Compare configuration with providers (live read)",
      apply: "Apply provider settings and runtime secrets (live write)",
      "database-connect": "Validate existing database configuration (local; no connection)",
      "database-check": "Check database permissions (live read)",
      migrate: "Apply missing database migrations (live write)",
      "runtime-setup": "Set up the restricted database role (live write; saves password locally)",
      "configure-client": "Generate public app/API configuration (local write)",
    }[action],
    args: [],
    mutation: ["apply", "runtime-setup", "migrate", "configure-client"].includes(action),
  })),
  {
    name: "deploy",
    category: "Deployment",
    label: "Build and deploy combined website/API (live write)",
    args: [],
    mutation: true,
  },
];
export function help() {
  return {
    usage: "node scripts/admin/index.mjs COMMAND [--yes]",
    mode: "Mutations return a review unless --yes is supplied. No terminal prompts.",
    grantIds:
      "Grant reviews generate a UUID. Supply that UUID when executing or retrying; --yes requires it.",
    commands,
  };
}

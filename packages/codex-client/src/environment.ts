const credentialEnvironmentNames = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_CONFIG_FILE",
  "AWS_PROFILE",
  "AWS_ROLE_ARN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AZURE_CLIENT_SECRET",
  "AZURE_OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_REMOTE_TOKEN",
  "OPENAI_API_KEY",
]);

export function scrubCodexEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(inherited).filter(([name]) => {
      if (credentialEnvironmentNames.has(name)) return false;
      return !/^(?:OPENAI|CODEX|AWS|AZURE)_.+(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE)/u.test(
        name,
      );
    }),
  );
}

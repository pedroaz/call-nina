export function childEnvironment(extra = {}) {
  // Admin credentials are never inherited by builds or unrelated child processes.
  const environment = { ...process.env };
  for (const name of Object.keys(environment))
    if (name.startsWith("PG") || /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE.*URL/.test(name))
      delete environment[name];
  return { ...environment, ...extra };
}

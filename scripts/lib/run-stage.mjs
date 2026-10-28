// Labels are fixed descriptions, never command arguments or environment values.
export function runStage(label, action) {
  const started = performance.now();
  const grouped = process.env.GITHUB_ACTIONS === "true";
  process.stdout.write(`${grouped ? "::group::" : "[START] "}${label}\n`);
  try {
    const result = action();
    process.stdout.write(
      `[DONE] ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)\n`,
    );
    return result;
  } catch (error) {
    process.stderr.write(
      `[FAIL] ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)\n`,
    );
    throw error;
  } finally {
    if (grouped) process.stdout.write("::endgroup::\n");
  }
}

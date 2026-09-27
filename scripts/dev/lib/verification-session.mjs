import { _electron as electron } from "playwright";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "../../..");
export const runtimeRoot = path.join(root, ".runtime");
export const workloads = ["correction", "generation", "helper", "research"];
export function failure(code) {
  return new Error(code);
}
export function safeCode(error, fallback = "VERIFY_ACTION_FAILED") {
  return /^VERIFY_[A-Z0-9_:]+$/.test(error?.message ?? "") ? error.message : fallback;
}
export async function until(check, code, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw failure(code);
}
export function productionEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      name.startsWith("CALL_NINA_TEST_") ||
      name.startsWith("CALL_NINA_APPIMAGE_") ||
      [
        "CALL_NINA_DATA_ROOT",
        "CALL_NINA_BOOTSTRAP_FILE",
        "CALL_NINA_RENDERER_URL",
        "CALL_NINA_RUNTIME_DIR",
        "CALL_NINA_READY_FILE",
        "ELECTRON_RUN_AS_NODE",
      ].includes(name)
    )
      delete environment[name];
  }
  return environment;
}
export class VerificationSession {
  constructor(directory, recovery, options = {}) {
    this.options = options;
    this.directory = directory;
    this.journal = recovery ?? { schemaVersion: 1, preferences: {}, records: [], notes: [] };
    this.phase = "launch";
  }
  async persist() {
    const temporary = path.join(this.directory, "recovery.tmp");
    await writeFile(temporary, JSON.stringify(this.journal), { mode: 0o600 });
    await rename(temporary, path.join(this.directory, "recovery.json"));
  }
  async launch() {
    const packagedExecutable = this.options.executable;
    if (packagedExecutable && !path.isAbsolute(packagedExecutable))
      throw failure("VERIFY_EXECUTABLE_INVALID");
    this.application = await electron
      .launch({
        ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
        args: [
          ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
          ...(packagedExecutable ? [] : [path.join(root, "apps/desktop/dist/main/index.js")]),
          ...["config-dir", "codex-executable"]
            .filter((key) => this.options[key])
            .map((key) => `--${key}=${this.options[key]}`),
        ],
        cwd: root,
        env: productionEnvironment(),
        timeout: 30000,
      })
      .catch(() => {
        throw failure("VERIFY_ELECTRON_LAUNCH_FAILED_OR_APP_ALREADY_RUNNING");
      });
    this.page = await this.application.firstWindow({ timeout: 15000 });
    this.mainPage = this.page;
    this.page.setDefaultTimeout(15000);
    await this.page
      .getByRole("heading", { level: 1 })
      .first()
      .waitFor({ timeout: 30000 })
      .catch(async () => {
        await this.page
          .screenshot({ path: path.join(this.directory, "screenshot.png") })
          .catch(() => {});
        throw failure("VERIFY_APP_WINDOW_UNAVAILABLE");
      });
    this.initialLocale =
      this.journal.locale ?? (await this.page.locator("html").getAttribute("lang"));
    this.journal.locale = this.initialLocale;
    await this.persist();
    this.phase = "ready";
  }
  async t(key) {
    const locale = (await this.page.locator("html").getAttribute("lang")) === "de" ? "de" : "en";
    this.catalogs ??= {};
    this.catalogs[locale] ??= JSON.parse(
      await readFile(path.join(root, `apps/desktop/src/renderer/locales/${locale}.json`), "utf8"),
    );
    const label = key.split(".").reduce((value, part) => value?.[part], this.catalogs[locale]);
    if (typeof label !== "string") throw failure("VERIFY_LABEL_UNAVAILABLE");
    return label;
  }
  async button(key, scope = this.page) {
    return scope.getByRole("button", { name: await this.t(key), exact: true });
  }
  async navigate(name) {
    const nav = this.page
      .getByRole("navigation")
      .filter({ has: this.page.getByRole("list") })
      .first();
    await nav.getByRole("list").getByRole("button", { name, exact: true }).click();
  }
  async settings() {
    await this.navigate(await this.t("nav.settings"));
    await this.page
      .getByRole("tab", { name: await this.t("settings.tabs.models"), exact: true })
      .click();
    await this.page.locator('[data-workload="generation"] select').first().waitFor();
  }
  async preferences() {
    const result = {};
    for (const workload of workloads) {
      const row = this.page.locator(`[data-workload="${workload}"]`);
      result[workload] = {
        model: await row.locator("select").nth(0).inputValue(),
        effort: await row.locator("select").nth(1).inputValue(),
      };
    }
    return result;
  }
  async saveSettings() {
    const save = await this.button("settings.save");
    if (await save.isEnabled()) {
      await save.click();
      await until(async () => {
        const currentSave = await this.button("settings.save");
        const message = this.page.getByText(await this.t("settings.saved"), { exact: true });
        return (await message.isVisible()) && !(await currentSave.isEnabled());
      }, "VERIFY_SETTINGS_SAVE_FAILED");
    }
  }
  async prepareAI() {
    this.phase = "select-luna";
    await this.settings();
    for (const workload of workloads) {
      const row = this.page.locator(`[data-workload="${workload}"]`);
      if (
        (await row
          .locator("select")
          .first()
          .locator('option[value="exact:gpt-6-luna"]')
          .count()) !== 1
      )
        throw failure("VERIFY_LUNA_UNAVAILABLE");
    }
    if (Object.keys(this.journal.preferences).length === 0) {
      this.journal.preferences = await this.preferences();
      await this.persist();
    }
    for (const workload of workloads) {
      const row = this.page.locator(`[data-workload="${workload}"]`);
      await row.locator("select").nth(0).selectOption("exact:gpt-6-luna");
      await row.locator("select").nth(1).selectOption("semantic:balanced");
      await until(async () => {
        const defaultEffort = await row.getAttribute("data-default-effort");
        return (
          defaultEffort &&
          (await row.getAttribute("data-effective-model")) === "gpt-6-luna" &&
          (await row.getAttribute("data-effective-effort")) === defaultEffort
        );
      }, "VERIFY_LUNA_DEFAULT_UNAVAILABLE");
    }
    await this.saveSettings();
    // Reopen from persisted settings, not just the unsaved draft.
    await this.navigate(await this.t("dashboard.title"));
    await this.settings();
    const observed = await this.preferences();
    if (
      workloads.some(
        (workload) =>
          observed[workload].model !== "exact:gpt-6-luna" ||
          observed[workload].effort !== "semantic:balanced",
      )
    )
      throw failure("VERIFY_LUNA_SELECTION_FAILED");
    this.aiPrepared = true;
    this.phase = "ready";
    return { model: "gpt-6-luna", effort: "runtime-default" };
  }
  async library(kind = "practice") {
    await this.navigate(await this.t("practice.title"));
    await this.page
      .getByRole("tab", { name: await this.t("practice.library.title"), exact: true })
      .click();
    const filter = await this.button(
      `practice.library.filters.${kind === "speaking" ? "voice-speaking" : kind === "listening" ? "codex-listening" : "all"}`,
    );
    if (await filter.isVisible()) await filter.click();
    const section = this.page.locator("main section[aria-busy]").filter({
      has: this.page.getByRole("heading", {
        name: await this.t("practice.library.title"),
        exact: true,
      }),
    });
    await until(
      async () => (await section.getAttribute("data-library-ready")) === "true",
      "VERIFY_LIBRARY_UNAVAILABLE",
    );
    const more = await this.button("practice.library.loadMore");
    for (let page = 0; await more.isVisible(); page++) {
      if (page >= 100) throw failure("VERIFY_LIBRARY_LIMIT");
      const count = await section.locator('[id^="activity-open-"]').count();
      await more.click();
      await until(
        async () =>
          !(await more.isVisible()) ||
          (await section.locator('[id^="activity-open-"]').count()) > count,
        "VERIFY_LIBRARY_LOAD_FAILED",
      );
    }
    return section;
  }
  async activityIds(kind = "practice") {
    const section = await this.library(kind);
    const buttons = await section.locator('[id^="activity-open-"]').all();
    return Promise.all(
      buttons.map(async (button) =>
        (await button.getAttribute("id")).slice("activity-open-".length),
      ),
    );
  }
  async beginRecords(kind = "practice") {
    if (!["practice", "speaking", "listening"].includes(kind))
      throw failure("VERIFY_RECORD_KIND_INVALID");
    this.baseline = { kind, ids: await this.activityIds(kind) };
    if (!this.journal.notes.includes("UNCONFIRMED_CREATION"))
      this.journal.notes.push("UNCONFIRMED_CREATION");
    await this.persist();
    return { kind, existingCount: this.baseline.ids.length };
  }
  async trackActivity(id) {
    if (!/^activity_[0-9a-z]{16,64}$/.test(id ?? "")) throw failure("VERIFY_INVALID_ACTIVITY_ID");
    if (!this.baseline || this.baseline.ids.includes(id)) throw failure("VERIFY_RECORD_NOT_NEW");
    if ((await this.page.locator("[data-activity-id]").getAttribute("data-activity-id")) !== id)
      throw failure("VERIFY_RECORD_NOT_VISIBLE");
    if (!this.journal.records.some((record) => record.id === id))
      this.journal.records.push({ id, kind: this.baseline.kind });
    this.journal.notes = this.journal.notes.filter((note) => note !== "UNCONFIRMED_CREATION");
    await this.persist();
  }
  async cleanupActivity(id) {
    const record = this.journal.records.find((record) => record.id === id);
    if (!record) throw failure("VERIFY_RECORD_NOT_OWNED");
    await this.library(record.kind);
    const open = this.page.locator(`[id="activity-open-${id}"]`);
    if (await open.count()) {
      const card = open.locator("..");
      const buttons = card.getByRole("button");
      if ((await buttons.count()) !== 2) throw failure("VERIFY_RECORD_CLEANUP_BLOCKED");
      await buttons.nth(1).click();
      const dialog = this.page.getByRole("dialog");
      const confirm = await this.button("practice.library.deleteConfirm", dialog);
      if (!(await confirm.isVisible())) {
        await dialog.press("Escape");
        throw failure("VERIFY_RECORD_CLEANUP_BLOCKED");
      }
      await confirm.click();
      await open.waitFor({ state: "detached" });
    }
    if ((await this.activityIds(record.kind)).includes(id)) throw failure("VERIFY_RECORD_RETAINED");
    this.journal.records = this.journal.records.filter((record) => record.id !== id);
    await this.persist();
  }
  async restore() {
    this.page = this.mainPage;
    const failures = [];
    for (const record of [...this.journal.records]) {
      try {
        await this.cleanupActivity(record.id);
      } catch {
        failures.push("VERIFY_RECORD_CLEANUP_FAILED");
      }
    }
    try {
      if (Object.keys(this.journal.preferences).length) {
        await this.settings();
        for (const [workload, preference] of Object.entries(this.journal.preferences)) {
          const row = this.page.locator(`[data-workload="${workload}"]`);
          await row.locator("select").nth(0).selectOption(preference.model);
          await row.locator("select").nth(1).selectOption(preference.effort);
        }
        await this.saveSettings();
        await this.navigate(await this.t("dashboard.title"));
        await this.settings();
        if (JSON.stringify(await this.preferences()) !== JSON.stringify(this.journal.preferences))
          throw failure("VERIFY_SETTINGS_RESTORE_FAILED");
        this.journal.preferences = {};
      }
      if (
        await this.page
          .getByRole("navigation")
          .filter({ has: this.page.getByRole("list") })
          .count()
      ) {
        await this.navigate(await this.t("nav.settings"));
        await this.page
          .getByRole("tab", { name: await this.t("settings.tabs.profile"), exact: true })
          .click();
        await this.page
          .getByRole("combobox", { name: await this.t("settings.uiLocale"), exact: true })
          .selectOption(this.initialLocale);
        await this.saveSettings();
      }
      if ((await this.page.locator("html").getAttribute("lang")) !== this.initialLocale) {
        await this.page
          .getByRole("button", {
            name: this.initialLocale === "de" ? "Deutsch" : "English",
            exact: true,
          })
          .click();
        await until(
          async () => (await this.page.locator("html").getAttribute("lang")) === this.initialLocale,
          "VERIFY_LOCALE_RESTORE_FAILED",
        );
      }
    } catch {
      failures.push("VERIFY_SETTINGS_RESTORE_FAILED");
      if (!this.journal.notes.includes("SETTINGS_RESTORE_REQUIRED"))
        this.journal.notes.push("SETTINGS_RESTORE_REQUIRED");
    }
    if (!failures.includes("VERIFY_SETTINGS_RESTORE_FAILED"))
      this.journal.notes = this.journal.notes.filter(
        (note) => note !== "SETTINGS_RESTORE_REQUIRED",
      );
    this.aiPrepared = false;
    await this.persist();
    return {
      failures,
      remainingRecords: this.journal.records,
      remainingPreferences: Object.keys(this.journal.preferences),
      notes: this.journal.notes,
    };
  }
}

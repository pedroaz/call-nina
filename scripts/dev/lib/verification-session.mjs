import { _electron as electron } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { recordVerificationApp, writePrivateJson } from "./verification-client.mjs";

export const root = path.resolve(import.meta.dirname, "../../..");
export const runtimeRoot = path.join(root, ".runtime");
export const locales = { "en-US": "en", "pt-BR": "pt-BR", es: "es", de: "de" };
export const languageNames = {
  "en-US": "English",
  "pt-BR": "Português brasileiro",
  es: "Español",
  de: "Deutsch",
};
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
  constructor(directory, recovery, options = {}, ownership) {
    this.options = options;
    this.directory = directory;
    this.ownership = ownership;
    this.journal = recovery ?? { schemaVersion: 1, preferences: {}, records: [], notes: [] };
    this.baseline = this.journal.baseline;
    this.phase = "launch";
  }
  async persist() {
    await writePrivateJson(path.join(this.directory, "recovery.json"), this.journal);
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
    await recordVerificationApp(this.ownership, this.application.process().pid);
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
    const selectedLanguage = this.page
      .getByRole("navigation", { includeHidden: true })
      .getByRole("combobox", {
        name: await this.t("onboarding.targetLanguage"),
        exact: true,
        includeHidden: true,
      });
    if (!this.journal.initialTarget && (await selectedLanguage.count()) === 1) {
      this.journal.initialTarget = await selectedLanguage.inputValue();
      this.journal.initialRoot = await this.page
        .locator("[data-learning-root]")
        .getAttribute("data-learning-root");
      if (!this.journal.notes.includes("LEARNING_SETTINGS_RESTORE_REQUIRED"))
        this.journal.notes.push("LEARNING_SETTINGS_RESTORE_REQUIRED");
    }
    delete this.journal.suspended;
    await this.persist();
    this.phase = "ready";
  }
  async t(key) {
    const locale = locales[await this.page.locator("html").getAttribute("lang")];
    if (!locale) throw failure("VERIFY_LOCALE_UNSUPPORTED");
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
  async profileSettings() {
    await this.navigate(await this.t("nav.nina"));
    await this.navigate(await this.t("nav.settings"));
    await this.page
      .getByRole("tab", { name: await this.t("settings.tabs.profile"), exact: true })
      .click();
    await this.page.locator('[data-settings-ready="true"]').waitFor();
  }
  async profileValues() {
    const panel = this.page.getByRole("tabpanel");
    const value = async (key, role = "combobox") =>
      panel.getByRole(role, { name: await this.t(key), exact: true }).inputValue();
    const language = await value("onboarding.targetLanguage");
    return {
      language,
      rootGeneration: await this.page
        .locator("[data-settings-root]")
        .getAttribute("data-settings-root"),
      level: await value("onboarding.level"),
      goal: await value("onboarding.goal", "textbox"),
      teaching: await value("settings.teachingProfile"),
      explanation: await value("onboarding.explanationLanguage"),
      ...(language === "de"
        ? {
            enrolled: await panel
              .getByRole("checkbox", { name: await this.t("onboarding.enrollCourse"), exact: true })
              .isChecked(),
          }
        : {}),
    };
  }
  async rememberSettings() {
    // Only capture an unedited persisted profile. Never replace an earlier baseline.
    const profile = this.page.locator("#settings-profile-title");
    if (!(await profile.isVisible())) return;
    const language = await this.page
      .locator("[data-settings-language]")
      .getAttribute("data-settings-language");
    if (this.journal.learningPreferences?.[language]) return;
    if (!(await this.page.locator('[data-settings-ready="true"]').count()))
      throw failure("VERIFY_SETTINGS_BASELINE_REQUIRED");
    const values = await this.profileValues();
    if (!locales[values.language] || !values.rootGeneration)
      throw failure("VERIFY_SETTINGS_BASELINE_REQUIRED");
    this.journal.learningPreferences ??= {};
    this.journal.learningPreferences[values.language] = values;
    this.journal.initialTarget ??= values.language;
    this.journal.initialRoot ??= values.rootGeneration;
    if (!this.journal.notes.includes("LEARNING_SETTINGS_RESTORE_REQUIRED"))
      this.journal.notes.push("LEARNING_SETTINGS_RESTORE_REQUIRED");
    await this.persist();
  }
  async selectLanguage(language) {
    if (!locales[language]) throw failure("VERIFY_RECORD_SCOPE_UNKNOWN");
    await this.profileSettings();
    if (
      this.journal.initialRoot &&
      (await this.page.locator("[data-settings-root]").getAttribute("data-settings-root")) !==
        this.journal.initialRoot
    )
      throw failure("VERIFY_SETTINGS_ROOT_CHANGED");
    const select = this.page
      .getByRole("tabpanel")
      .getByRole("combobox", { name: await this.t("onboarding.targetLanguage"), exact: true });
    if ((await select.inputValue()) !== language) {
      await this.rememberSettings();
      await select.selectOption(language);
      await until(
        async () =>
          (await this.page
            .locator('[data-settings-ready="true"]')
            .getAttribute("data-settings-language")) === language,
        "VERIFY_LANGUAGE_SWITCH_FAILED",
      );
    }
  }
  async scopeOf(element) {
    const language = await element.getAttribute("data-learning-language");
    const rootGeneration = await element.getAttribute("data-root-generation");
    if (!locales[language] || !rootGeneration) throw failure("VERIFY_RECORD_SCOPE_UNKNOWN");
    return { language, rootGeneration };
  }
  async assertScope(element, expected) {
    const actual = await this.scopeOf(element);
    if (actual.language !== expected.language || actual.rootGeneration !== expected.rootGeneration)
      throw failure("VERIFY_RECORD_SCOPE_MISMATCH");
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
    await this.navigate(await this.t("nav.nina"));
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
  async materialLibrary() {
    await this.navigate(await this.t("nav.practice"));
    await this.page.getByRole("tab", { name: await this.t("ui.newPractice"), exact: true }).click();
    await (await this.button("practice.types.reading.title")).click();
    const disclosure = this.page.locator("details").filter({
      has: this.page
        .locator("summary")
        .getByText(await this.t("materialPractice.optional"), { exact: true }),
    });
    if ((await disclosure.getAttribute("open")) === null)
      await disclosure.locator("summary").click();
    const workspace = disclosure.locator("[data-material-workspace]");
    const back = await this.button("materialPractice.back", workspace);
    if (await back.isVisible()) await back.click();
    await (await this.button("materialPractice.load", workspace)).click();
    await until(
      async () => (await workspace.getAttribute("data-material-ready")) === "true",
      "VERIFY_MATERIAL_LIBRARY_UNAVAILABLE",
    );
    const more = await this.button("materialPractice.more", workspace);
    for (let page = 0; await more.isVisible(); page++) {
      if (page >= 100) throw failure("VERIFY_LIBRARY_LIMIT");
      const count = await workspace.locator('[id^="material-open-"]').count();
      await more.click();
      await until(
        async () =>
          !(await more.isVisible()) ||
          (await workspace.locator('[id^="material-open-"]').count()) > count,
        "VERIFY_LIBRARY_LOAD_FAILED",
      );
    }
    return workspace;
  }
  async activityIds(kind = "practice") {
    const section = kind === "material" ? await this.materialLibrary() : await this.library(kind);
    const prefix = kind === "material" ? "material-open-" : "activity-open-";
    const buttons = await section.locator(`[id^="${prefix}"]`).all();
    return Promise.all(
      buttons.map(async (button) => (await button.getAttribute("id")).slice(prefix.length)),
    );
  }
  async beginRecords(kind = "practice") {
    if (this.journal.notes.includes("UNCONFIRMED_CREATION"))
      throw failure("VERIFY_RECORD_BASELINE_UNRESOLVED");
    if (!["practice", "speaking", "listening", "material"].includes(kind))
      throw failure("VERIFY_RECORD_KIND_INVALID");
    const materialIds = kind === "material" ? undefined : await this.activityIds("material");
    const materialScope =
      kind === "material"
        ? undefined
        : await this.scopeOf(this.page.locator("[data-material-workspace]:visible"));
    const ids = await this.activityIds(kind);
    const scope = await this.scopeOf(
      kind === "material" ? await this.materialLibrary() : await this.library(kind),
    );
    if (
      materialScope &&
      (materialScope.language !== scope.language ||
        materialScope.rootGeneration !== scope.rootGeneration)
    )
      throw failure("VERIFY_RECORD_SCOPE_MISMATCH");
    const revisions = {};
    if (kind === "material")
      for (const id of ids)
        revisions[id] = await this.page
          .locator(`[id="material-open-${id}"]`)
          .getAttribute("data-material-revision");
    this.baseline = {
      kind,
      ids,
      ...scope,
      ...(kind === "material" ? { revisions } : { materialIds }),
    };
    this.journal.baseline = this.baseline;
    if (!this.journal.notes.includes("UNCONFIRMED_CREATION"))
      this.journal.notes.push("UNCONFIRMED_CREATION");
    await this.persist();
    return { kind, existingCount: this.baseline.ids.length };
  }
  async confirmNoCreation(confirmation) {
    if (
      confirmation !== "no-creation-submitted" ||
      this.journal.records.length ||
      this.journal.pendingAction ||
      this.journal.interruptedActions?.length ||
      !this.journal.baseline ||
      !this.journal.notes.includes("UNCONFIRMED_CREATION")
    )
      throw failure("VERIFY_NO_CREATION_UNPROVEN");
    const baseline = this.journal.baseline;
    await this.assertScope(
      baseline.kind === "material"
        ? await this.materialLibrary()
        : await this.library(baseline.kind),
      baseline,
    );
    const observed = await this.activityIds(baseline.kind);
    if (
      observed.length !== baseline.ids.length ||
      observed.some((id) => !baseline.ids.includes(id))
    )
      throw failure("VERIFY_NO_CREATION_UNPROVEN");
    if (baseline.kind === "material") {
      for (const id of observed)
        if (
          (await this.page
            .locator(`[id="material-open-${id}"]`)
            .getAttribute("data-material-revision")) !== baseline.revisions?.[id]
        )
          throw failure("VERIFY_NO_CREATION_UNPROVEN");
    }
    if (baseline.materialIds) {
      const materials = await this.activityIds("material");
      await this.assertScope(this.page.locator("[data-material-workspace]:visible"), baseline);
      if (
        materials.length !== baseline.materialIds.length ||
        materials.some((id) => !baseline.materialIds.includes(id))
      )
        throw failure("VERIFY_NO_CREATION_UNPROVEN");
    }
    this.journal.receipts ??= [];
    this.journal.receipts.push({
      code: "NO_CREATION_SUBMITTED",
      at: new Date().toISOString(),
      evidence: "unchanged-library-and-operator-attestation",
      deletedRecords: 0,
    });
    this.journal.notes = this.journal.notes.filter((note) => note !== "UNCONFIRMED_CREATION");
    delete this.journal.baseline;
    this.baseline = undefined;
    await this.persist();
    return { status: "reconciled", deletedRecords: 0 };
  }
  async trackActivity(id) {
    const material = this.baseline?.kind === "material";
    if (!(material ? /^material_[0-9a-z]{16,64}$/ : /^activity_[0-9a-z]{16,64}$/).test(id ?? ""))
      throw failure("VERIFY_INVALID_ACTIVITY_ID");
    const owned = this.journal.records.find((record) => record.id === id);
    if (
      !this.baseline ||
      (this.baseline.ids.includes(id) &&
        !(material && owned && this.baseline.revisions?.[id] === owned.revision))
    )
      throw failure("VERIFY_RECORD_NOT_NEW");
    const visible = this.page.locator(
      material ? "[data-material-id]:visible" : "[data-activity-id]:visible",
    );
    if ((await visible.getAttribute(material ? "data-material-id" : "data-activity-id")) !== id)
      throw failure("VERIFY_RECORD_NOT_VISIBLE");
    await this.assertScope(
      material
        ? this.page.locator("[data-material-workspace]:visible").filter({ has: visible })
        : visible,
      this.baseline,
    );
    const revision = material ? await visible.getAttribute("data-material-revision") : undefined;
    if (material && !/^material-revision_[0-9a-z]{16,64}$/.test(revision ?? ""))
      throw failure("VERIFY_RECORD_NOT_VISIBLE");
    if (owned) {
      if (
        owned.language !== this.baseline.language ||
        owned.rootGeneration !== this.baseline.rootGeneration
      )
        throw failure("VERIFY_RECORD_SCOPE_MISMATCH");
      if (!material || (await visible.getAttribute("data-material-saved-from")) !== owned.revision)
        throw failure("VERIFY_MATERIAL_EDIT_UNPROVEN");
      this.journal.receipts ??= [];
      this.journal.receipts.push({
        code: "OWNED_MATERIAL_REVISION",
        at: new Date().toISOString(),
        id,
        previousRevision: owned.revision,
        revision,
        language: owned.language,
        rootGeneration: owned.rootGeneration,
      });
      owned.revision = revision;
    } else
      this.journal.records.push({
        id,
        kind: this.baseline.kind,
        language: this.baseline.language,
        rootGeneration: this.baseline.rootGeneration,
        ...(material ? { revision } : {}),
      });
    if (!material) {
      const materialId = await visible.getAttribute("data-activity-material-id");
      const materialRevision = await visible.getAttribute("data-activity-material-revision");
      if (materialId) {
        if (
          !Array.isArray(this.baseline.materialIds) ||
          !/^material_[0-9a-z]{16,64}$/.test(materialId) ||
          !/^material-revision_[0-9a-z]{16,64}$/.test(materialRevision ?? "")
        )
          throw failure("VERIFY_MATERIAL_BASELINE_REQUIRED");
        if (
          !this.baseline.materialIds.includes(materialId) &&
          !this.journal.records.some((record) => record.id === materialId)
        )
          this.journal.records.push({
            id: materialId,
            kind: "material",
            revision: materialRevision,
            language: this.baseline.language,
            rootGeneration: this.baseline.rootGeneration,
          });
      }
    }
    this.journal.notes = this.journal.notes.filter((note) => note !== "UNCONFIRMED_CREATION");
    delete this.journal.baseline;
    this.baseline = undefined;
    await this.persist();
  }
  async cleanupActivity(id) {
    const record = this.journal.records.find((record) => record.id === id);
    if (!record) throw failure("VERIFY_RECORD_NOT_OWNED");
    await this.selectLanguage(record.language);
    if (record.kind === "material") {
      const workspace = await this.materialLibrary();
      await this.assertScope(workspace, record);
      const open = workspace.locator(`[id="material-open-${id}"]`);
      if (await open.count()) {
        if ((await open.getAttribute("data-material-revision")) !== record.revision)
          throw failure("VERIFY_MATERIAL_REVISION_CHANGED");
        await open.click();
        if ((await workspace.locator("[data-material-id]").getAttribute("data-material-id")) !== id)
          throw failure("VERIFY_RECORD_NOT_VISIBLE");
        await (await this.button("materialPractice.remove", workspace)).click();
        await (
          await this.button("materialPractice.removeConfirm", this.page.getByRole("dialog"))
        ).click();
        await workspace.locator("[data-material-id]").waitFor({ state: "detached" });
      }
      await this.assertScope(await this.materialLibrary(), record);
      if ((await this.activityIds("material")).includes(id))
        throw failure("VERIFY_RECORD_RETAINED");
      this.journal.records = this.journal.records.filter((entry) => entry.id !== id);
      await this.persist();
      return;
    }
    await this.assertScope(await this.library(record.kind), record);
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
    await this.assertScope(await this.library(record.kind), record);
    if ((await this.activityIds(record.kind)).includes(id)) throw failure("VERIFY_RECORD_RETAINED");
    this.journal.records = this.journal.records.filter((record) => record.id !== id);
    await this.persist();
  }
  async restore() {
    this.page = this.mainPage;
    const failures = [];
    for (const record of [...this.journal.records].sort(
      (a, b) => Number(a.kind === "material") - Number(b.kind === "material"),
    )) {
      try {
        await this.cleanupActivity(record.id);
      } catch {
        failures.push("VERIFY_RECORD_CLEANUP_FAILED");
      }
    }
    try {
      for (const preference of Object.values({ ...this.journal.learningPreferences })) {
        await this.selectLanguage(preference.language);
        const observed = await this.profileValues();
        if (observed.rootGeneration !== preference.rootGeneration)
          throw failure("VERIFY_SETTINGS_ROOT_CHANGED");
        const panel = this.page.getByRole("tabpanel");
        for (const [field, key] of [
          ["level", "onboarding.level"],
          ["teaching", "settings.teachingProfile"],
          ["explanation", "onboarding.explanationLanguage"],
        ])
          await panel
            .getByRole("combobox", { name: await this.t(key), exact: true })
            .selectOption(preference[field]);
        await panel
          .getByRole("textbox", { name: await this.t("onboarding.goal"), exact: true })
          .fill(preference.goal);
        if (preference.language === "de")
          await panel
            .getByRole("checkbox", { name: await this.t("onboarding.enrollCourse"), exact: true })
            .setChecked(preference.enrolled);
        await this.saveSettings();
        await this.navigate(await this.t("nav.nina"));
        await this.profileSettings();
        if (JSON.stringify(await this.profileValues()) !== JSON.stringify(preference))
          throw failure("VERIFY_SETTINGS_RESTORE_FAILED");
      }
      if (this.journal.initialTarget) await this.selectLanguage(this.journal.initialTarget);
      delete this.journal.learningPreferences;
      delete this.journal.initialTarget;
      delete this.journal.initialRoot;
      this.journal.notes = this.journal.notes.filter(
        (note) => note !== "LEARNING_SETTINGS_RESTORE_REQUIRED",
      );
      if (Object.keys(this.journal.preferences).length) {
        await this.settings();
        for (const [workload, preference] of Object.entries(this.journal.preferences)) {
          const row = this.page.locator(`[data-workload="${workload}"]`);
          await row.locator("select").nth(0).selectOption(preference.model);
          await row.locator("select").nth(1).selectOption(preference.effort);
        }
        await this.saveSettings();
        await this.navigate(await this.t("nav.nina"));
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
            name: languageNames[this.initialLocale],
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
    if (!failures.length) {
      // These operations are reconciled by the successful UI readback above.
      this.journal.interruptedActions = (this.journal.interruptedActions ?? []).filter(
        (entry) => !["prepare-ai", "restore", "stop", "cleanup"].includes(entry.action),
      );
      if (
        !this.journal.interruptedActions.length &&
        (!this.journal.pendingAction ||
          ["restore", "stop"].includes(this.journal.pendingAction.action))
      )
        this.journal.notes = this.journal.notes.filter(
          (note) => !["INTERRUPTED_SHUTDOWN", "ACTION_RECONCILIATION_REQUIRED"].includes(note),
        );
    }
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

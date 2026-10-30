import { _electron as electron } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  recordVerificationApp,
  writePrivateJson,
  journalFingerprint,
} from "./verification-client.mjs";

export const root = path.resolve(import.meta.dirname, "../../..");
export const runtimeRoot = path.join(root, ".runtime");
export const locales = { "en-US": "en", "pt-BR": "pt-BR", es: "es", de: "de" };
export const languageNames = {
  "en-US": "English",
  "pt-BR": "Português brasileiro",
  es: "Español",
  de: "Deutsch",
};
export function failure(code) {
  return new Error(code);
}
// This is the current Settings UI serialization, shared by capture and resume.
// Keep schemaVersion 1: already-retained connection journals use this envelope.
// Historical workload maps and unknown fields cannot prove restoration ownership.
export function validateVerificationPreferences(preference, initialRoot) {
  if (!preference || typeof preference !== "object" || Array.isArray(preference))
    throw failure("VERIFY_RECOVERY_INVALID");
  if (Object.keys(preference).length === 0) return preference;
  const selectionId = (value) =>
    typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
  if (
    Object.keys(preference).sort().join(",") !== "connectionId,effort,model,rootGeneration,route" ||
    typeof preference.connectionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      preference.connectionId,
    ) ||
    preference.route !== "chatgpt" ||
    typeof preference.rootGeneration !== "string" ||
    !/^[1-9][0-9]*$/.test(preference.rootGeneration) ||
    !Number.isSafeInteger(Number(preference.rootGeneration)) ||
    (initialRoot !== undefined && preference.rootGeneration !== initialRoot) ||
    !selectionId(preference.model) ||
    !selectionId(preference.effort) ||
    (preference.effort.startsWith("semantic:") &&
      !["semantic:fast", "semantic:balanced", "semantic:deep"].includes(preference.effort))
  )
    throw failure("VERIFY_RECOVERY_INVALID");
  return preference;
}
export const mutatingActions = [
  "click",
  "double-click",
  "fill",
  "upload-image",
  "select",
  "press",
  "prepare-ai",
  "cleanup",
  "restore",
  "stop",
];
const recordKinds = ["practice", "speaking", "listening", "material", "vocabulary"];
function recordIdPattern(kind) {
  return kind === "material"
    ? /^material_[0-9a-z]{16,64}$/
    : kind === "vocabulary"
      ? /^vocabulary_[0-9a-z]{16,64}$/
      : /^activity_[0-9a-z]{16,64}$/;
}
export function validateVerificationJournal(previous) {
  if (
    !previous ||
    typeof previous !== "object" ||
    Array.isArray(previous) ||
    previous.schemaVersion !== 1
  )
    throw failure("VERIFY_RECOVERY_INVALID");
  validateVerificationPreferences(previous.preferences, previous.initialRoot);
  const needsRecovery = Boolean(
    previous.suspended ||
    previous.baseline ||
    previous.initialTarget ||
    previous.localeRestore ||
    Object.keys(previous.learningPreferences ?? {}).length ||
    previous.records?.length ||
    Object.keys(previous.preferences ?? {}).length ||
    previous.notes?.length ||
    previous.pendingAction ||
    previous.interruptedActions?.length,
  );
  if (
    !Array.isArray(previous.records) ||
    !Array.isArray(previous.notes) ||
    !previous.preferences ||
    (previous.receipts !== undefined && !Array.isArray(previous.receipts)) ||
    (previous.locale !== undefined && !["en", ...Object.keys(locales)].includes(previous.locale)) ||
    (previous.locale === undefined && Object.keys(previous.preferences).length)
  )
    throw failure("VERIFY_RECOVERY_INVALID");
  if (
    previous.records.some(
      (r) =>
        !recordIdPattern(r.kind).test(r.id) ||
        !recordKinds.includes(r.kind) ||
        (r.kind === "vocabulary" && !/^activity_[0-9a-z]{16,64}$/.test(r.sourceActivityId ?? "")),
    )
  )
    throw failure("VERIFY_RECOVERY_INVALID");
  if (previous.initialRoot !== undefined && !/^[1-9][0-9]*$/.test(previous.initialRoot))
    throw failure("VERIFY_RECOVERY_INVALID");
  if (previous.initialTarget !== undefined && !locales[previous.initialTarget])
    throw failure("VERIFY_RECOVERY_INVALID");
  for (const [language, preference] of Object.entries(previous.learningPreferences ?? {})) {
    if (
      !locales[language] ||
      preference.language !== language ||
      !/^[1-9][0-9]*$/.test(preference.rootGeneration) ||
      !["a1", "a2", "b1", "b2"].includes(preference.level) ||
      typeof preference.goal !== "string" ||
      preference.goal.length > 500 ||
      !locales[preference.explanation] ||
      !["conversation-partner", "strict-corrector"].includes(preference.teaching) ||
      (language === "de" && typeof preference.enrolled !== "boolean")
    )
      throw failure("VERIFY_RECOVERY_INVALID");
  }
  if (
    previous.notes.some(
      (note) => typeof note !== "string" || !/^[A-Z][A-Z0-9_]{0,100}$/.test(note),
    ) ||
    (previous.interruptedActions !== undefined && !Array.isArray(previous.interruptedActions))
  )
    throw failure("VERIFY_RECOVERY_INVALID");
  for (const entry of [
    ...(previous.interruptedActions ?? []),
    ...(previous.pendingAction ? [previous.pendingAction] : []),
  ]) {
    if (
      !entry ||
      !mutatingActions.includes(entry.action) ||
      typeof entry.startedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.startedAt))
    )
      throw failure("VERIFY_RECOVERY_INVALID");
  }
  if (
    previous.baseline &&
    (!Array.isArray(previous.baseline.ids) ||
      !recordKinds.includes(previous.baseline.kind) ||
      previous.baseline.ids.some((id) => !recordIdPattern(previous.baseline.kind).test(id)))
  )
    throw failure("VERIFY_RECOVERY_INVALID");
  return { journal: previous, needsRecovery };
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
  constructor(directory, recovery, options = {}, ownership, context = { targetRoot: root }) {
    this.context = context;
    this.options = options;
    this.directory = directory;
    this.ownership = ownership;
    this.journal = recovery ?? { schemaVersion: 1, preferences: {}, records: [], notes: [] };
    this.baseline = this.journal.baseline;
    this.phase = "launch";
  }
  async persist() {
    validateVerificationPreferences(this.journal.preferences, this.journal.initialRoot);
    await writePrivateJson(path.join(this.directory, "recovery.json"), this.journal);
  }
  async launch() {
    const packagedExecutable = this.options.executable;
    if (this.context.provenance && Object.keys(this.options).length)
      throw failure("VERIFY_RECOVERY_OVERRIDE_FORBIDDEN");
    if (packagedExecutable && !path.isAbsolute(packagedExecutable))
      throw failure("VERIFY_EXECUTABLE_INVALID");
    this.application = await electron
      .launch({
        ...(this.context.electronExecutable
          ? { executablePath: this.context.electronExecutable }
          : packagedExecutable
            ? { executablePath: packagedExecutable }
            : {}),
        args: [
          ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
          ...(packagedExecutable
            ? []
            : [path.join(this.context.targetRoot, "apps/desktop/dist/main/index.js")]),
          ...["config-dir", "codex-executable"]
            .filter((key) => this.options[key])
            .map((key) => `--${key}=${this.options[key]}`),
        ],
        cwd: this.context.targetRoot,
        env: productionEnvironment(),
        timeout: 30000,
      })
      .catch(() => {
        throw failure("VERIFY_ELECTRON_LAUNCH_FAILED_OR_APP_ALREADY_RUNNING");
      });
    await recordVerificationApp(this.ownership, this.application.process().pid, this.context);
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
    delete this.journal.suspended;
    await this.persist();
    this.phase = "ready";
  }
  async t(key) {
    const locale = locales[await this.page.locator("html").getAttribute("lang")];
    if (!locale) throw failure("VERIFY_LOCALE_UNSUPPORTED");
    this.catalogs ??= {};
    this.catalogs[locale] ??= JSON.parse(
      await readFile(
        path.join(this.context.targetRoot, `apps/desktop/src/renderer/locales/${locale}.json`),
        "utf8",
      ),
    );
    const catalog = this.catalogs[locale];
    if (!catalog.flashcards) {
      const shared = JSON.parse(
        await readFile(
          path.join(this.context.targetRoot, "packages/learning-ui/src/flashcards.json"),
          "utf8",
        ),
      );
      catalog.flashcards = shared[locale === "en" ? "en-US" : locale];
    }
    const label = key.split(".").reduce((value, part) => value?.[part], catalog);
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
  async rememberSettings(target) {
    // Navigation and screenshots do not create restoration obligations.
    if (target) {
      const tag = await target.evaluate((element) => element.tagName.toLowerCase());
      const save = await this.button("settings.save");
      if (!["input", "select", "textarea"].includes(tag) && !(await target.and(save).count()))
        return;
    }
    // Only capture an unedited persisted profile. Never replace an earlier baseline.
    const profile = this.page.locator("#settings-profile-title");
    if (!(await profile.isVisible())) return;
    const language = await this.page
      .locator("[data-settings-language]")
      .getAttribute("data-settings-language");
    if (
      target &&
      (await target
        .and(
          this.page.getByRole("combobox", { name: await this.t("settings.uiLocale"), exact: true }),
        )
        .count())
    ) {
      this.journal.localeRestore = true;
      this.journal.expectedLocale ??= await this.page.locator("html").getAttribute("lang");
      await this.persist();
    }
    if (this.journal.learningPreferences?.[language]) return;
    if (!(await this.page.locator('[data-settings-ready="true"]').count()))
      throw failure("VERIFY_SETTINGS_BASELINE_REQUIRED");
    const values = await this.profileValues();
    if (!locales[values.language] || !values.rootGeneration)
      throw failure("VERIFY_SETTINGS_BASELINE_REQUIRED");
    this.journal.learningPreferences ??= {};
    this.journal.learningPreferences[values.language] = values;
    this.journal.expectedLearningPreferences ??= {};
    this.journal.expectedLearningPreferences[values.language] = values;
    this.journal.expectedTarget ??= values.language;
    this.journal.initialTarget ??= values.language;
    this.journal.initialRoot ??= values.rootGeneration;
    if (!this.journal.notes.includes("LEARNING_SETTINGS_RESTORE_REQUIRED"))
      this.journal.notes.push("LEARNING_SETTINGS_RESTORE_REQUIRED");
    await this.persist();
  }
  async isProfileSave(target) {
    return (
      Boolean(await this.page.locator("#settings-profile-title").isVisible()) &&
      Boolean(await target.and(await this.button("settings.save")).count())
    );
  }
  async observeSettingsAfterAction(profileSave, selection, localeBefore) {
    const localeAfter = await this.page.locator("html").getAttribute("lang");
    if (localeBefore && localeAfter !== localeBefore) {
      if (!this.journal.localeRestore) {
        this.initialLocale = localeBefore;
        this.journal.locale = localeBefore;
      }
      this.journal.localeRestore = true;
      this.journal.expectedLocale = localeAfter;
    }
    if (selection) this.journal.expectedTarget = selection.selectedLanguage;
    if (!profileSave) return;
    await this.page.locator('[data-settings-ready="true"]').waitFor();
    const values = await this.profileValues();
    if (this.journal.learningPreferences?.[values.language]) {
      this.journal.expectedLearningPreferences ??= {};
      this.journal.expectedLearningPreferences[values.language] = values;
    }
    if (this.journal.localeRestore)
      this.journal.expectedLocale = await this.page.locator("html").getAttribute("lang");
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
      this.journal.expectedTarget = language;
      await this.persist();
    }
  }
  async languageSelectionOwnership(target, selectedLanguage) {
    if (!Object.hasOwn(locales, selectedLanguage)) return undefined;
    const name = await this.t("onboarding.targetLanguage");
    const profile = this.page.getByRole("tabpanel").getByRole("combobox", { name, exact: true });
    const navigation = this.page
      .getByRole("navigation")
      .getByRole("combobox", { name, exact: true });
    const kind =
      (await target.and(profile).count()) === 1
        ? "profile-language"
        : (await target.and(navigation).count()) === 1
          ? "navigation-language"
          : undefined;
    if (!kind) return undefined;
    if (!this.journal.initialTarget) {
      this.journal.initialTarget = await target.inputValue();
      this.journal.expectedTarget = this.journal.initialTarget;
      this.journal.initialRoot = await this.page
        .locator("[data-learning-root]")
        .getAttribute("data-learning-root");
      await this.persist();
    }
    const rootGeneration = await this.page
      .locator("[data-learning-root]")
      .getAttribute("data-learning-root");
    if (
      !Object.hasOwn(locales, this.journal.initialTarget) ||
      !/^[1-9][0-9]*$/.test(rootGeneration ?? "") ||
      rootGeneration !== this.journal.initialRoot
    )
      throw failure("VERIFY_SETTINGS_BASELINE_REQUIRED");
    return { kind, selectedLanguage, rootGeneration, initialTarget: this.journal.initialTarget };
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
    this.phase = "settings-navigation";
    await this.navigate(await this.t("nav.settings"));
    await this.page
      .getByRole("tab", { name: await this.t("settings.tabs.ai"), exact: true })
      .click();
    const tab = this.page.getByRole("tabpanel");
    this.phase = "settings-management";
    const management = tab.locator("[data-connection-management]");
    const active = management.locator('option[data-active-connection="true"]');
    await active.waitFor({ state: "attached" });
    const connectionId = await active.getAttribute("value");
    if (!connectionId) throw failure("VERIFY_AI_CONNECTION_UNAVAILABLE");
    const picker = management.getByRole("combobox", {
      name: await this.t("connectionSettings.savedConnections"),
      exact: true,
    });
    if ((await picker.inputValue()) !== connectionId) await picker.selectOption(connectionId);
    const panel = tab.locator("[data-ai-connection]");
    await panel.waitFor();
    if ((await panel.getAttribute("data-dirty")) !== "false")
      throw failure("VERIFY_SETTINGS_UNRESTORABLE");
    await panel
      .getByRole("heading", { name: await this.t("connectionSettings.advanced"), exact: true })
      .waitFor();
    this.phase = "settings-ready";
    return panel;
  }
  async preferences() {
    const panel = this.page.getByRole("tabpanel").locator("[data-ai-connection]");
    const preference = {
      connectionId: await panel.getAttribute("data-ai-connection"),
      route: await panel.getAttribute("data-route"),
      rootGeneration: await panel.getAttribute("data-root-generation"),
      model: await panel
        .getByRole("combobox", { name: await this.t("modelControl.model"), exact: true })
        .inputValue()
        .catch(() => {
          throw failure("VERIFY_AI_MODEL_CONTROL_UNAVAILABLE");
        }),
      effort: await panel
        .getByRole("combobox", { name: await this.t("settings.effort"), exact: true })
        .inputValue()
        .catch(() => {
          throw failure("VERIFY_AI_EFFORT_CONTROL_UNAVAILABLE");
        }),
    };
    return validateVerificationPreferences(preference, this.journal.initialRoot);
  }
  async selectAiPreference(panel, key, value) {
    const control = panel.getByRole("combobox", { name: await this.t(key), exact: true });
    this.phase = "settings-select";
    if ((await control.inputValue()) === value) return;
    const revision = await panel.getAttribute("data-connection-revision");
    await control.selectOption(value);
    const save = panel.getByRole("button", { name: await this.t("settings.save"), exact: true });
    await save.click();
    await until(
      async () =>
        (await panel.getAttribute("aria-busy")) === "false" &&
        (await panel.getAttribute("data-connection-revision")) !== revision &&
        (await panel.getAttribute("data-dirty")) === "false" &&
        (await control.inputValue()) === value,
      "VERIFY_SETTINGS_SAVE_FAILED",
    );
    if (Object.keys(this.journal.preferences).length) {
      this.journal.expectedPreferences = await this.preferences();
      await this.persist();
    }
  }
  async saveSettings() {
    // The persisted/dirty state is the contract; button visibility is presentation.
    if (await this.page.locator('[data-settings-ready="true"]').count()) return;
    const save = await this.button("settings.save");
    if (!(await save.count()) || !(await save.isEnabled()))
      throw failure("VERIFY_SETTINGS_SAVE_UNAVAILABLE");
    await save.click();
    await this.page.locator('[data-settings-ready="true"]').waitFor();
  }
  async prepareAI(route = "chatgpt") {
    if (route === "managed") {
      const configuration = JSON.parse(
        await readFile(
          path.join(this.context.targetRoot, "packages/contracts/src/nina-public.preview.json"),
          "utf8",
        ),
      );
      if (!configuration.modelId) throw failure("VERIFY_MANAGED_MODEL_UNAVAILABLE");
      // The operator selects routing in Settings first. Verify the actual action's
      // resolved UI selection without changing unrelated capability assignments.
      const summary = this.page.getByRole("status").filter({
        hasText: configuration.modelId,
      });
      await summary.first().waitFor();
      if (
        !(await summary.first().innerText()).includes(
          await this.t("connectionSettings.routes.managed"),
        )
      )
        throw failure("VERIFY_MANAGED_ROUTE_REQUIRED");
      this.aiPrepared = true;
      return { route: "managed", model: configuration.modelId, effort: "runtime-default" };
    }
    this.phase = "select-luna";
    const panel = await this.settings();
    const current = await this.preferences();
    if (current.route !== "chatgpt") throw failure("VERIFY_CHATGPT_CONNECTION_REQUIRED");
    // Refuse to mutate an unavailable saved selection that cannot be restored
    // through the current advertised controls; keep the original journal intact.
    if (!(await panel.getAttribute("data-effective-model")))
      throw failure("VERIFY_SETTINGS_UNRESTORABLE");
    if ((await panel.locator('option[value="gpt-6-luna"]').count()) !== 1)
      throw failure("VERIFY_LUNA_UNAVAILABLE");
    if (Object.keys(this.journal.preferences).length === 0) {
      this.journal.preferences = current;
      await this.persist();
    } else if (
      this.journal.preferences.connectionId !== current.connectionId ||
      this.journal.preferences.rootGeneration !== current.rootGeneration ||
      this.journal.preferences.route !== current.route
    ) {
      throw failure("VERIFY_SETTINGS_SCOPE_CHANGED");
    }
    await this.selectAiPreference(panel, "modelControl.model", "gpt-6-luna");
    await this.selectAiPreference(panel, "settings.effort", "semantic:balanced");
    await until(async () => {
      const defaultEffort = await panel.getAttribute("data-default-effort");
      return (
        defaultEffort &&
        (await panel.getAttribute("data-effective-model")) === "gpt-6-luna" &&
        (await panel.getAttribute("data-effective-effort")) === defaultEffort
      );
    }, "VERIFY_LUNA_DEFAULT_UNAVAILABLE");
    await this.navigate(await this.t("nav.nina"));
    await this.settings();
    const observed = await this.preferences();
    if (
      observed.connectionId !== current.connectionId ||
      observed.rootGeneration !== current.rootGeneration ||
      observed.route !== current.route ||
      observed.model !== "gpt-6-luna" ||
      observed.effort !== "semantic:balanced"
    )
      throw failure("VERIFY_LUNA_SELECTION_FAILED");
    this.journal.expectedPreferences = observed;
    await this.persist();
    this.aiPrepared = true;
    this.phase = "ready";
    return { model: "gpt-6-luna", effort: "runtime-default" };
  }
  async library(kind = "practice") {
    if (kind === "vocabulary") {
      await this.navigate(await this.t("nav.nina"));
      await this.navigate(await this.t("nav.vocabulary"));
      const section = this.page.locator("[data-vocabulary-ready]");
      await until(
        async () => (await section.getAttribute("data-vocabulary-ready")) === "true",
        "VERIFY_LIBRARY_UNAVAILABLE",
      );
      const clear = await this.button("vocabulary.flow.clearFilters", section);
      if (await clear.isVisible()) await clear.click();
      await until(
        async () => (await section.getAttribute("data-vocabulary-ready")) === "true",
        "VERIFY_LIBRARY_UNAVAILABLE",
      );
      const total = Number(await section.getAttribute("data-vocabulary-total"));
      if (
        !Number.isSafeInteger(total) ||
        total < 0 ||
        total > 30 ||
        (await section.locator('[id^="vocabulary-open-"]').count()) !== total
      )
        throw failure("VERIFY_VOCABULARY_BASELINE_INCOMPLETE");
      return section;
    }
    await this.navigate(await this.t("practice.title"));
    await this.page
      .getByRole("tab", { name: await this.t("practice.library.title"), exact: true })
      .click();
    const filter = await this.button(
      `practice.library.filters.${kind === "speaking" ? "voice-speaking" : kind === "listening" ? "codex-listening" : "all"}`,
    );
    if (await filter.isVisible()) await filter.click();
    const section = this.page.locator("main section[data-library-ready]");
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
      has: this.page.getByText(await this.t("materialPractice.optional"), { exact: true }),
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
    const prefix =
      kind === "material"
        ? "material-open-"
        : kind === "vocabulary"
          ? "vocabulary-open-"
          : "activity-open-";
    const buttons = await section.locator(`[id^="${prefix}"]`).all();
    return Promise.all(
      buttons.map(async (button) => (await button.getAttribute("id")).slice(prefix.length)),
    );
  }
  async beginRecords(kind = "practice") {
    if (this.journal.notes.includes("UNCONFIRMED_CREATION"))
      throw failure("VERIFY_RECORD_BASELINE_UNRESOLVED");
    if (!recordKinds.includes(kind)) throw failure("VERIFY_RECORD_KIND_INVALID");
    const materialIds = ["material", "vocabulary"].includes(kind)
      ? undefined
      : await this.activityIds("material");
    const materialScope = ["material", "vocabulary"].includes(kind)
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
    const cancelled =
      confirmation === "cancelled-without-creation" &&
      this.journal.notes.includes("CANCELLED_UI_OBSERVED_NO_ACTIVITY");
    if (
      (!cancelled && confirmation !== "no-creation-submitted") ||
      (!cancelled && this.journal.records.length) ||
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
      code: cancelled ? "CANCELLED_WITHOUT_CREATION" : "NO_CREATION_SUBMITTED",
      at: new Date().toISOString(),
      evidence: cancelled
        ? "observed-cancellation-and-unchanged-libraries"
        : "unchanged-library-and-operator-attestation",
      deletedRecords: 0,
    });
    this.journal.notes = this.journal.notes.filter(
      (note) =>
        note !== "UNCONFIRMED_CREATION" &&
        (!cancelled || note !== "CANCELLED_UI_OBSERVED_NO_ACTIVITY"),
    );
    delete this.journal.baseline;
    this.baseline = undefined;
    await this.persist();
    return { status: "reconciled", deletedRecords: 0 };
  }
  async trackActivity(id) {
    const material = this.baseline?.kind === "material";
    const vocabulary = this.baseline?.kind === "vocabulary";
    if (!recordIdPattern(this.baseline?.kind).test(id ?? ""))
      throw failure("VERIFY_INVALID_ACTIVITY_ID");
    const owned = this.journal.records.find((record) => record.id === id);
    if (
      !this.baseline ||
      (this.baseline.ids.includes(id) &&
        !(material && owned && this.baseline.revisions?.[id] === owned.revision))
    )
      throw failure("VERIFY_RECORD_NOT_NEW");
    const identityAttribute = material
      ? "data-material-id"
      : vocabulary
        ? "data-current-vocabulary-id"
        : "data-activity-id";
    const visible = this.page.locator(`[${identityAttribute}]:visible`);
    if ((await visible.getAttribute(identityAttribute)) !== id)
      throw failure("VERIFY_RECORD_NOT_VISIBLE");
    await this.assertScope(
      material
        ? this.page.locator("[data-material-workspace]:visible").filter({ has: visible })
        : visible,
      this.baseline,
    );
    const sourceActivityId = vocabulary
      ? await visible.getAttribute("data-activity-id")
      : undefined;
    if (
      vocabulary &&
      !this.journal.records.some(
        (record) =>
          record.id === sourceActivityId &&
          record.kind !== "vocabulary" &&
          record.kind !== "material" &&
          record.language === this.baseline.language &&
          record.rootGeneration === this.baseline.rootGeneration,
      )
    )
      throw failure("VERIFY_VOCABULARY_SOURCE_NOT_OWNED");
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
        ...(vocabulary ? { sourceActivityId } : {}),
      });
    if (!material && !vocabulary) {
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
  async cleanupActivityHistory(record) {
    // Each row must prove exact exercise/activity ownership; never delete by title or position.
    for (let count = 0; count < 200; count++) {
      await this.navigate(await this.t("nav.nina"));
      await this.navigate(await this.t("nav.history"));
      const history = this.page.locator('[data-history-ready="true"]');
      await history.waitFor();
      if ((await history.getAttribute("data-root-generation")) !== record.rootGeneration)
        throw failure("VERIFY_RECORD_SCOPE_MISMATCH");
      const ownershipAttribute =
        record.kind === "vocabulary" ? "data-history-vocabulary-id" : "data-history-activity-id";
      const candidate = history.locator(`[${ownershipAttribute}="${record.id}"]`).first();
      if (!(await candidate.count())) return;
      const historyEntryId = await candidate.getAttribute("data-history-entry-id");
      if (!/^history-entry_[0-9a-z]{16,64}$/.test(historyEntryId ?? ""))
        throw failure("VERIFY_HISTORY_OWNERSHIP_UNPROVEN");
      const entry = this.page.locator(`[data-history-entry-id="${historyEntryId}"]`);
      await this.assertScope(entry, record);
      await entry.locator("summary").first().click();
      await (await this.button("history.delete", entry)).click();
      await (await this.button("actions.delete", this.page.getByRole("dialog"))).click();
      await entry.waitFor({ state: "detached" });
      this.journal.receipts ??= [];
      this.journal.receipts.push({
        code:
          record.kind === "vocabulary"
            ? "OWNED_VOCABULARY_HISTORY_REMOVED"
            : "OWNED_ACTIVITY_HISTORY_REMOVED",
        at: new Date().toISOString(),
        ...(record.kind === "vocabulary" ? { vocabularyId: record.id } : { activityId: record.id }),
        historyEntryId,
        language: record.language,
        rootGeneration: record.rootGeneration,
      });
      await this.persist();
    }
    throw failure("VERIFY_HISTORY_CLEANUP_LIMIT");
  }
  recordCleanupReadback(record) {
    const fingerprints = [
      { action: "cleanup", id: record.id },
      { id: record.id, action: "cleanup" },
    ].map((request) => journalFingerprint(JSON.stringify(request)));
    this.journal.receipts ??= [];
    this.journal.interruptedActions = (this.journal.interruptedActions ?? []).filter((entry) => {
      if (entry.action !== "cleanup" || !fingerprints.includes(entry.requestFingerprint))
        return true;
      this.journal.receipts.push({
        code: "INTERRUPTED_CLEANUP_RECONCILED",
        at: new Date().toISOString(),
        originalAction: entry,
        dispatchOccurrence: "unknown",
        resolution: "scoped-record-absence-readback",
        record,
      });
      return false;
    });
  }
  async cleanupActivity(id) {
    const record = this.journal.records.find((record) => record.id === id);
    if (!record) throw failure("VERIFY_RECORD_NOT_OWNED");
    if (
      this.context.provenance &&
      record.kind === "material" &&
      this.journal.records.some((entry) => entry.kind !== "material")
    )
      throw failure("VERIFY_ACTIVITY_CLEANUP_REQUIRED");
    await this.selectLanguage(record.language);
    if (record.kind === "vocabulary") {
      await this.cleanupActivityHistory(record);
      const library = await this.library("vocabulary");
      await this.assertScope(library, record);
      const open = library.locator(`[id="vocabulary-open-${id}"]`);
      if (await open.count()) {
        await open.click();
        const detail = this.page.locator(`[data-vocabulary-id="${id}"]:visible`);
        await this.assertScope(detail, record);
        await (await this.button("vocabulary.delete", this.page.getByRole("dialog"))).click();
        await (
          await this.button("vocabulary.delete", this.page.getByRole("dialog").last())
        ).click();
        await detail.waitFor({ state: "detached" });
      }
      await this.assertScope(await this.library("vocabulary"), record);
      if ((await this.activityIds("vocabulary")).includes(id))
        throw failure("VERIFY_RECORD_RETAINED");
      this.recordCleanupReadback(record);
      this.journal.records = this.journal.records.filter((entry) => entry.id !== id);
      await this.persist();
      return;
    }
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
      this.recordCleanupReadback(record);
      this.journal.records = this.journal.records.filter((entry) => entry.id !== id);
      await this.persist();
      return;
    }
    await this.cleanupActivityHistory(record);
    await this.assertScope(await this.library(record.kind), record);
    const open = this.page.locator(`[id="activity-open-${id}"]`);
    if (await open.count()) {
      const card = this.page.getByRole("article").filter({ has: open });
      const buttons = card.getByRole("button");
      if ((await buttons.count()) !== 2) throw failure("VERIFY_RECORD_CLEANUP_BLOCKED");
      await buttons.nth(1).click();
      const menu = this.page.getByRole("menu");
      if ((await menu.getByRole("menuitem").count()) !== 1)
        throw failure("VERIFY_RECORD_CLEANUP_BLOCKED");
      await menu.getByRole("menuitem").click();
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
    this.recordCleanupReadback(record);
    this.journal.records = this.journal.records.filter((record) => record.id !== id);
    await this.persist();
  }
  async historicalLanguageSelection(proof) {
    const invalid = () => failure("VERIFY_LANGUAGE_SELECTION_PROOF_INVALID");
    if (
      !proof ||
      typeof proof !== "object" ||
      Array.isArray(proof) ||
      Object.keys(proof).sort().join(",") !==
        "actionId,initialTarget,request,rootGeneration,sourceHead" ||
      !/^[0-9a-f-]{36}$/.test(proof.actionId ?? "") ||
      !/^[0-9a-f]{40}$/.test(proof.sourceHead ?? "") ||
      !Object.hasOwn(locales, proof.initialTarget) ||
      !/^[1-9][0-9]*$/.test(proof.rootGeneration ?? "") ||
      proof.initialTarget !== this.journal.initialTarget ||
      proof.rootGeneration !== this.journal.initialRoot
    )
      throw invalid();
    const request = proof.request;
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      Object.keys(request).sort().join(",") !== "action,target,value" ||
      request.action !== "select" ||
      !Object.hasOwn(locales, request.value) ||
      !request.target ||
      typeof request.target !== "object" ||
      Array.isArray(request.target) ||
      Object.keys(request.target).sort().join(",") !== "name,role" ||
      request.target.role !== "combobox" ||
      typeof request.target.name !== "string"
    )
      throw invalid();
    const labels = [];
    for (const locale of Object.values(locales)) {
      const catalog = JSON.parse(
        await readFile(
          path.join(this.context.targetRoot, `apps/desktop/src/renderer/locales/${locale}.json`),
          "utf8",
        ),
      );
      labels.push(catalog.onboarding.targetLanguage);
    }
    if (!labels.includes(request.target.name)) throw invalid();
    const matches = (this.journal.interruptedActions ?? []).filter(
      (entry) => entry.actionId === proof.actionId,
    );
    const entry = matches[0];
    if (
      matches.length !== 1 ||
      entry.action !== "select" ||
      entry.phase !== "dispatch-may-have-started" ||
      entry.sourceHead !== proof.sourceHead ||
      entry.requestFingerprint !== journalFingerprint(JSON.stringify(request))
    )
      throw invalid();
    return {
      actionId: entry.actionId,
      selection: {
        kind: "learning-language",
        selectedLanguage: request.value,
        rootGeneration: proof.rootGeneration,
        initialTarget: proof.initialTarget,
      },
    };
  }
  async restore(languageSelectionProof) {
    const historicalSelection =
      languageSelectionProof === undefined
        ? undefined
        : await this.historicalLanguageSelection(languageSelectionProof);
    this.page = this.mainPage;
    const failures = [];
    let restoredSelection;
    const currentTarget = this.page
      .getByRole("navigation", { includeHidden: true })
      .getByRole("combobox", {
        name: await this.t("onboarding.targetLanguage"),
        exact: true,
        includeHidden: true,
      });
    if (this.journal.initialTarget && (await currentTarget.count())) {
      const current = await currentTarget.inputValue();
      if (current !== this.journal.initialTarget && current !== this.journal.expectedTarget)
        throw failure("VERIFY_SETTINGS_CHANGED_EXTERNALLY");
    }
    if (this.journal.localeRestore) {
      const current = await this.page.locator("html").getAttribute("lang");
      if (current !== this.initialLocale && current !== this.journal.expectedLocale)
        throw failure("VERIFY_SETTINGS_CHANGED_EXTERNALLY");
    }
    for (const record of [...this.journal.records].sort(
      (a, b) =>
        (a.kind === "vocabulary" ? 0 : a.kind === "material" ? 2 : 1) -
        (b.kind === "vocabulary" ? 0 : b.kind === "material" ? 2 : 1),
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
        if (JSON.stringify(observed) === JSON.stringify(preference)) continue;
        if (
          JSON.stringify(observed) !==
          JSON.stringify(this.journal.expectedLearningPreferences?.[preference.language])
        )
          throw failure("VERIFY_SETTINGS_CHANGED_EXTERNALLY");
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
      if (this.journal.initialTarget) {
        await this.selectLanguage(this.journal.initialTarget);
        const observed = await this.profileValues();
        if (
          observed.language !== this.journal.initialTarget ||
          observed.rootGeneration !== this.journal.initialRoot
        )
          throw failure("VERIFY_SETTINGS_RESTORE_FAILED");
        restoredSelection = {
          language: observed.language,
          rootGeneration: observed.rootGeneration,
        };
      }
      if (Object.keys(this.journal.preferences).length) {
        const panel = await this.settings();
        const preference = this.journal.preferences;
        const current = await this.preferences();
        if (
          !preference.connectionId ||
          preference.connectionId !== current.connectionId ||
          preference.rootGeneration !== current.rootGeneration ||
          preference.route !== current.route
        )
          throw failure("VERIFY_SETTINGS_SCOPE_CHANGED");
        if (
          JSON.stringify(current) !== JSON.stringify(preference) &&
          JSON.stringify(current) !== JSON.stringify(this.journal.expectedPreferences)
        )
          throw failure("VERIFY_SETTINGS_CHANGED_EXTERNALLY");
        await this.selectAiPreference(panel, "modelControl.model", preference.model);
        await this.selectAiPreference(panel, "settings.effort", preference.effort);
        await this.navigate(await this.t("nav.nina"));
        await this.settings();
        const restored = await this.preferences();
        if (Object.entries(preference).some(([key, value]) => restored[key] !== value))
          throw failure("VERIFY_SETTINGS_RESTORE_FAILED");
        this.journal.preferences = {};
      }
      if (
        this.journal.localeRestore &&
        (await this.page
          .getByRole("navigation")
          .filter({ has: this.page.getByRole("list") })
          .count())
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
      if (
        this.journal.localeRestore &&
        (await this.page.locator("html").getAttribute("lang")) !== this.initialLocale
      ) {
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
      delete this.journal.learningPreferences;
      delete this.journal.expectedLearningPreferences;
      delete this.journal.expectedPreferences;
      delete this.journal.localeRestore;
      delete this.journal.expectedLocale;
      this.journal.notes = this.journal.notes.filter(
        (note) => note !== "LEARNING_SETTINGS_RESTORE_REQUIRED",
      );
    } catch (error) {
      failures.push("VERIFY_SETTINGS_RESTORE_FAILED");
      const code = safeCode(error, "VERIFY_SETTINGS_RESTORE_FAILED");
      if (code !== "VERIFY_SETTINGS_RESTORE_FAILED") failures.push(code);
      if (!this.journal.notes.includes("SETTINGS_RESTORE_REQUIRED"))
        this.journal.notes.push("SETTINGS_RESTORE_REQUIRED");
    }
    if (!failures.includes("VERIFY_SETTINGS_RESTORE_FAILED")) {
      this.journal.notes = this.journal.notes.filter(
        (note) => note !== "SETTINGS_RESTORE_REQUIRED",
      );
      this.journal.interruptedActions = (this.journal.interruptedActions ?? []).filter((entry) => {
        const historical =
          historicalSelection !== undefined && historicalSelection.actionId === entry.actionId;
        const selection = historical
          ? historicalSelection.selection
          : entry.learningLanguageSelection;
        if (
          entry.action !== "select" ||
          !selection ||
          !(historical
            ? selection.kind === "learning-language"
            : ["profile-language", "navigation-language"].includes(selection.kind)) ||
          !Object.hasOwn(locales, selection.selectedLanguage) ||
          !restoredSelection ||
          selection.initialTarget !== restoredSelection.language ||
          selection.rootGeneration !== restoredSelection.rootGeneration ||
          !/^[a-f0-9]{64}$/.test(entry.requestFingerprint ?? "")
        )
          return true;
        this.journal.receipts ??= [];
        this.journal.receipts.push({
          code: "INTERRUPTED_LANGUAGE_SELECTION_RECONCILED",
          at: new Date().toISOString(),
          originalAction: entry,
          selectionOwnership: selection,
          proof: historical ? "exact-request-fingerprint" : "pre-dispatch-target-ownership",
          dispatchOccurrence: "unknown",
          resolution: "initial-language-and-settings-ui-readback",
          readback: restoredSelection,
        });
        return false;
      });
      // Preserve the original selection baseline while any unproven select remains.
      if (!this.journal.interruptedActions.some((entry) => entry.action === "select")) {
        delete this.journal.expectedTarget;
        delete this.journal.initialTarget;
        delete this.journal.initialRoot;
      }
    }
    if (!failures.length) {
      // These operations are reconciled by the successful UI readback above.
      this.journal.interruptedActions = (this.journal.interruptedActions ?? []).filter((entry) => {
        if (!["prepare-ai", "restore", "stop"].includes(entry.action)) return true;
        this.journal.receipts ??= [];
        this.journal.receipts.push({
          code: "INTERRUPTED_RESTORATION_RECONCILED",
          at: new Date().toISOString(),
          originalAction: entry,
          dispatchOccurrence: "unknown",
          resolution: "settings-and-owned-records-readback",
        });
        return false;
      });
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

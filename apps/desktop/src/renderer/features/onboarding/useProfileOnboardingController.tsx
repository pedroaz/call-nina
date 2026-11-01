import { useUsageAnalytics } from "../../runtime/usage-analytics.js";
import {
  languageDefinitions,
  languageIds,
  utcInstantSchema,
  type CallNinaError,
  type CourseUnit,
  type Language,
} from "@call-nina/contracts";
import { courseActivityStatus } from "@call-nina/domain";
import { Briefcase, MessageCircle, Pencil, Plane } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/index.js";
import { type PathDestination } from "../../learning/curriculum/learningPathNavigation.js";
import { learningGoalPreset } from "../../learning/profile/goal-presets.js";
import { type LearningChoices } from "../../learning/profile/LearningProfileFields.js";
import i18n from "../../runtime/i18n.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../../runtime/ipc.js";
import type { DesktopSettingsResult } from "../../runtime/settings-adapter.js";
import type { LearningPathSnapshot } from "../../runtime/useLearningPath.js";
import {
  type Account,
  type LoginId,
  type ProfileOnboardingProps,
} from "./ProfileOnboarding.types.js";

export function useProfileOnboardingController({
  readiness,
  onComplete,
  onExit,
}: ProfileOnboardingProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const { refresh: refreshAnalytics, value: analyticsState } = useUsageAnalytics();
  const [includeConsent, setIncludeConsent] = useState(false);
  const [goalChoice, setGoalChoice] = useState("everyday");
  const [customGoal, setCustomGoal] = useState("");
  const [explanationTouched, setExplanationTouched] = useState(false);
  const initialLocale = (
    i18n.resolvedLanguage === "en" ? "en-US" : (i18n.resolvedLanguage ?? "en-US")
  ) as Language;
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [choices, setChoices] = useState<LearningChoices>({
    learnerName: "",
    approximateLevel: "a2",
    everydayLifeGoal: t("setupUx.goals.everyday"),
    defaultTeachingProfileId: "conversation-partner",
    explanationLanguage: initialLocale,
    uiLocale: initialLocale,
  });
  const [targetLanguage, setTargetLanguage] = useState<Language>("de");
  const [enrollCourse, setEnrollCourse] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [connectionPending, setConnectionPending] = useState(false);
  const [account, setAccount] = useState<Account>();
  const [loginId, setLoginId] = useState<LoginId>();
  const [catalog, setCatalog] = useState<LearningPathSnapshot>();
  const [catalogError, setCatalogError] = useState(false);
  const generation =
    readiness.dataRoot.status === "ready" ? readiness.dataRoot.generation : undefined;
  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const usage = await refreshAnalytics();
      setIncludeConsent(Boolean(usage?.available));
      const profile = await invokeDesktop("learner-profile/read", {});
      if (profile.status === "ready") {
        const next = await invokeDesktop("learner-settings/read", {});
        setPersisted(next);
        setChoices(next.settings);
        setCustomGoal(next.settings.everydayLifeGoal);
        setTargetLanguage(next.settings.learningScope.targetLanguage);
        setEnrollCourse(Boolean(next.settings.learningScope.courseId));
        await i18n.changeLanguage(next.settings.uiLocale);
        setGoalChoice(learningGoalPreset(next.settings.everydayLifeGoal) ?? "custom");
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLoading(false);
    }
  }, [refreshAnalytics]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    const refresh = () =>
      void invokeDesktop("chatgpt/account/read", {})
        .then(setAccount)
        .catch(() => undefined);
    refresh();
    return subscribeDesktop((event) => {
      if (event.event === "data-root-changed") window.location.reload();
      if (event.event === "state-invalidated" && event.scope === "account") refresh();
      if (event.event === "account-login" && event.loginId === loginId) {
        if (event.state.status === "failed") setError(event.state.error);
        if (["complete", "failed", "cancelled"].includes(event.state.status)) {
          setLoginId(undefined);
          refresh();
        }
      }
    });
  }, [loginId]);
  const change = <K extends keyof LearningChoices>(key: K, value: LearningChoices[K]) => {
    setChoices((current) => ({ ...current, [key]: value }));
  };
  const selectTarget = (language: Language) => {
    if (!persisted) {
      setTargetLanguage(language);
      return;
    }
    void attempt(async () => {
      const saved = await save();
      if (!saved) return;
      const next = await invokeDesktop("learner-settings/select-language", {
        expectedGeneration: saved.dataRoot.generation,
        targetLanguage: language,
      });
      setPersisted(next);
      setChoices(next.settings);
      setCustomGoal(next.settings.everydayLifeGoal);
      setTargetLanguage(language);
      setGoalChoice(learningGoalPreset(next.settings.everydayLifeGoal) ?? "custom");
      setEnrollCourse(Boolean(next.settings.learningScope.courseId));
      setCatalog(undefined);
    });
  };
  async function save(): Promise<DesktopSettingsResult | undefined> {
    if (!generation || !choices.everydayLifeGoal.trim()) return persisted;
    let current = persisted;
    if (!current) {
      await invokeDesktop("learner-profile/start-onboarding", {
        targetLanguage,
        ...choices,
        everydayLifeGoal: choices.everydayLifeGoal.trim(),
        expectedGeneration: generation,
        placement: { status: "skipped" },
      });
      current = await invokeDesktop("learner-settings/read", {});
    }
    const saved = current;
    if (
      Object.entries(choices).some(
        ([key, value]) => saved.settings[key as keyof LearningChoices] !== value,
      ) ||
      enrollCourse !== Boolean(saved.settings.learningScope.courseId)
    ) {
      // Preserve all settings outside this wizard and let the backend reject a stale timestamp.
      current = await invokeDesktop("learner-settings/update", {
        expectedUpdatedAt: current.updatedAt,
        settings: {
          ...current.settings,
          ...choices,
          everydayLifeGoal: choices.everydayLifeGoal.trim(),
          learningScope: {
            ...current.settings.learningScope,
            courseId: enrollCourse ? languageDefinitions[targetLanguage].structuredCourseId : null,
          },
        },
      });
    }
    setPersisted(current);
    await i18n.changeLanguage(choices.uiLocale);
    return current;
  }
  const cancelLogin = async () => {
    if (loginId) {
      await invokeDesktop("chatgpt/account/login/cancel", { loginId });
      setLoginId(undefined);
    }
  };
  const readCatalog = async () => {
    setCatalogError(false);
    try {
      setCatalog(await invokeDesktop("learning-path/read", {}));
    } catch {
      setCatalogError(true);
    }
  };
  const move = (next: number) =>
    void attempt(async () => {
      if (connectionPending || (next > step && step === 2 && !choices.everydayLifeGoal.trim()))
        return;
      await cancelLogin();
      if (step >= 4 || persisted) await save();
      const destination = next === 6 && !includeConsent ? (step > next ? 5 : 7) : next;
      if (destination === 7) await readCatalog();
      setStep(destination);
    });
  const finish = (destination?: PathDestination) =>
    void attempt(async () => {
      if (connectionPending) return;
      await cancelLogin();
      let current = await save();
      if (!current || !generation) return;
      if (destination && !current.settings.learningScope.courseId) {
        current = await invokeDesktop("learner-settings/update", {
          expectedUpdatedAt: current.updatedAt,
          settings: {
            ...current.settings,
            learningScope: {
              ...current.settings.learningScope,
              courseId: languageDefinitions[targetLanguage].structuredCourseId,
            },
          },
        });
      }
      await invokeDesktop("learner-profile/finish-onboarding", {
        expectedGeneration: generation,
        expectedUpdatedAt: utcInstantSchema.parse(current.updatedAt),
      });
      onComplete(destination);
    });
  const course = catalog?.course;
  const eligible =
    course?.units.filter(
      (unit) =>
        unit.kind !== "launchpad" &&
        unit.activities.some((activity) =>
          ["explanation", "reading", "practice"].includes(activity.delivery),
        ) &&
        unit.prerequisites.every((id) => {
          const prerequisite = course.units.find((entry) => entry.id === id);
          return prerequisite?.activities.every(
            (activity) =>
              catalog !== undefined &&
              courseActivityStatus(catalog.state, {
                version: course.version,
                unitId: id,
                activityKey: activity.id,
                mode: "course",
              }) === "completed",
          );
        }),
    ) ?? [];
  const first: CourseUnit | undefined =
    eligible.find(
      (unit) =>
        course?.paths.find((path) => path.id === unit.stage)?.level.toLowerCase() ===
        choices.approximateLevel,
    ) ?? eligible[0];
  const locale = choices.uiLocale === "en-US" ? ("en" as const) : choices.uiLocale;
  const titles = [
    "nameTitle",
    "languageTitle",
    "goalTitle",
    "levelTitle",
    "explanationTitle",
    "connectionTitle",
    "analyticsTitle",
    "lessonTitle",
  ];
  const languageOptions = languageIds.map((language) => ({
    value: language,
    label: t(`languages.${language}`),
  }));
  const goalOptions = [
    { value: "everyday", label: t("interview.goals.everyday"), icon: <MessageCircle /> },
    { value: "travel", label: t("interview.goals.travel"), icon: <Plane /> },
    { value: "work", label: t("interview.goals.work"), icon: <Briefcase /> },
    { value: "custom", label: t("interview.goals.custom"), icon: <Pencil /> },
  ];
  const pose =
    step === 7
      ? "celebration"
      : step === 2
        ? (
            {
              everyday: "listening",
              travel: "welcome",
              work: "thinking",
              custom: "thinking",
            } as const
          )[goalChoice as "everyday" | "travel" | "work" | "custom"]
        : step === 0
          ? "welcome"
          : step === 5
            ? "listening"
            : "thinking";
  const blocked = busy || connectionPending;
  const continueDisabled = blocked || (step === 2 && !choices.everydayLifeGoal.trim());
  const chooseAnalytics = (enabled: boolean, advance = false) =>
    void attempt(async () => {
      await invokeDesktop("analytics/consent", { enabled });
      await refreshAnalytics();
      if (advance) {
        await readCatalog();
        setStep(7);
      }
    });
  const complete = () => {
    finish();
  };
  const back = (
    <div>
      {step > 0 && (
        <Button
          variant="quiet"
          isDisabled={blocked}
          onPress={() => {
            move(step - 1);
          }}
        >
          {t("onboarding.back")}
        </Button>
      )}
      {onExit && step === 0 && (
        <Button
          variant="quiet"
          isDisabled={blocked}
          onPress={() =>
            void attempt(async () => {
              await cancelLogin();
              if (choices.everydayLifeGoal.trim()) await save();
              onExit();
            })
          }
        >
          {t("interview.goHome")}
        </Button>
      )}
    </div>
  );
  return {
    loading,
    includeConsent,
    analyticsConsent: analyticsState?.consent ?? "unknown",
    chooseAnalytics,
    t,
    step,
    complete,
    move,
    continueDisabled,
    choices,
    titles,
    targetLanguage,
    blocked,
    change,
    persisted,
    explanationTouched,
    pose,
    back,
    setStep,
    onExit,
    first,
    finish,
    languageOptions,
    selectTarget,
    goalChoice,
    goalOptions,
    setGoalChoice,
    customGoal,
    setCustomGoal,
    setExplanationTouched,
    busy,
    setConnectionPending,
    account,
    loginId,
    attempt,
    cancelLogin,
    setLoginId,
    locale,
    catalogError,
    readCatalog,
    error,
    load,
  };
}

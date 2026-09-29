import { useCallback, useEffect, useRef, useState } from "react";
import {
  languageSchema,
  ninaPracticeKindSchema,
  type DesktopIpcResponse,
  type CallNinaError,
  type NinaPlan,
  type NinaRequest,
  type MaterialReference,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  LoadingState,
  TextAreaField,
  SelectField,
  Disclosure,
  Muted,
} from "./components/ui/index.js";
import { ActionGroup, Page, SectionHeader } from "./components/layout/index.js";
import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "./ipc.js";
import { PracticeSuggestionCard } from "./PracticeSuggestionCard.js";
import { usePracticeSuggestion, type SuggestionActions } from "./usePracticeSuggestion.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { generatePracticeActivity, reusePracticeActivity } from "./generatePracticeActivity.js";
import { OperationProgress } from "./OperationProgress.js";
import { OperationError } from "./Startup.js";
import styles from "./Dashboard.module.css";

type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "nina/read" }>["result"];
type Recommendations = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"];
type Materials = Extract<DesktopIpcResponse, { status: "ok"; channel: "material/list" }>["result"];
type Destination = "writing" | "practice" | "vocabulary" | "learningPath" | "history";
export type NinaHomeDraft = {
  naturalRequest: string;
  minutes: string;
  material?: MaterialReference | undefined;
  materialTitle?: string | undefined;
  plan?: NinaPlan | undefined;
};
export const emptyNinaHomeDraft: NinaHomeDraft = { naturalRequest: "", minutes: "" };

export function NinaHome({
  onNavigate,
  draft,
  onDraftChange,
  ...actions
}: SuggestionActions & {
  onNavigate: (destination: Destination) => void;
  draft: NinaHomeDraft;
  onDraftChange: (draft: NinaHomeDraft) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = languageSchema.safeParse(i18n.resolvedLanguage).data ?? "en-US";
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [recommendations, setRecommendations] = useState<Recommendations>();
  const [materials, setMaterials] = useState<Materials>();
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [unavailable, setUnavailable] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const active = useRef(false);
  const reuseId = useRef<ReturnType<typeof createDesktopSubmissionId> | undefined>(undefined);
  const planHeading = useRef<HTMLHeadingElement>(null);
  const operation = useLearningOperation();
  const launch = usePracticeSuggestion(actions);
  const disabled = busy || Boolean(launch.starting);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    try {
      const [home, suggestions, library] = await Promise.all([
        invokeDesktop("nina/read", {}),
        invokeDesktop("dashboard/read", { locale }),
        invokeDesktop("material/list", {}),
      ]);
      if (current !== request.current || !mounted.current) return;
      if (
        home.rootGeneration !== suggestions.rootGeneration ||
        home.rootGeneration !== library.rootGeneration ||
        home.learningContext.targetLanguage !== library.language
      )
        throw new Error("OD_DATA_ROOT_STALE");
      setSnapshot(home);
      setRecommendations(suggestions);
      setMaterials(library);
    } catch (cause) {
      if (current === request.current && mounted.current)
        setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === request.current && mounted.current) setRefreshing(false);
    }
  }, [locale]);
  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && ["dashboard", "settings"].includes(event.scope))
        void refresh();
    });
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      request.current += 1;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);
  const edit = (patch: Partial<NinaHomeDraft>) => {
    reuseId.current = undefined;
    onDraftChange({ ...draft, ...patch, plan: undefined });
    setUnavailable(false);
  };
  const plan = async (kind?: NinaRequest["kind"]) => {
    if (!snapshot || active.current) return;
    active.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("nina/plan", {
        expectedGeneration: snapshot.rootGeneration,
        scope: {
          learnerId: snapshot.learningContext.learnerId,
          targetLanguage: snapshot.learningContext.targetLanguage,
          courseId: snapshot.learningContext.courseId,
        },
        naturalRequest: draft.naturalRequest,
        ...(draft.minutes ? { minutes: Number(draft.minutes) } : {}),
        ...(draft.material ? { material: draft.material } : {}),
        ...(kind ? { kind } : {}),
      });
      if (mounted.current) {
        reuseId.current = undefined;
        onDraftChange({ ...draft, plan: result });
        window.requestAnimationFrame(() => planHeading.current?.focus());
      }
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const start = async (prepared: boolean) => {
    if (draft.plan?.status !== "ready" || active.current) return;
    const selected = draft.plan;
    active.current = true;
    setBusy(true);
    setError(undefined);
    setUnavailable(false);
    try {
      let activityId;
      if (prepared && selected.prepared) {
        reuseId.current ??= createDesktopSubmissionId();
        activityId = await reusePracticeActivity(
          {
            activityId: selected.prepared.activityId,
            content: selected.prepared.content,
            context: { origin: "nina" },
            expectedGeneration: selected.request.expectedGeneration,
          },
          reuseId.current,
        );
        reuseId.current = undefined;
      } else {
        if (!(await actions.requestAiAccess("exercise-generation"))) {
          if (mounted.current) setUnavailable(true);
          return;
        }
        if (!mounted.current) return;
        activityId = await generatePracticeActivity(selected.request, operation.run, {
          origin: "nina",
        });
      }
      if (mounted.current) actions.onLaunch({ destination: "activity", activityId });
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const resume = async () => {
    if (!snapshot?.resume || active.current) return;
    active.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("activity/resolve", {
        action: "open-activity",
        activityId: snapshot.resume.activityId,
        expectedGeneration: snapshot.rootGeneration,
      });
      if (
        result.activity.context.learningScope.learnerId !== snapshot.learningContext.learnerId ||
        result.activity.context.learningScope.targetLanguage !==
          snapshot.learningContext.targetLanguage
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      if (mounted.current)
        actions.onLaunch({ destination: "activity", activityId: result.activity.activityId });
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const moreMaterials = async () => {
    if (!materials?.nextCursor || active.current) return;
    active.current = true;
    setBusy(true);
    try {
      const next = await invokeDesktop("material/list", { cursor: materials.nextCursor });
      if (next.rootGeneration !== materials.rootGeneration || next.language !== materials.language)
        throw new Error("OD_DATA_ROOT_STALE");
      if (mounted.current)
        setMaterials({ ...next, materials: [...materials.materials, ...next.materials] });
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const suggestions = recommendations?.suggestions ?? [];
  const visible = suggestions.length
    ? Array.from(
        { length: Math.min(3, suggestions.length) },
        (_, index) => suggestions[(offset + index) % suggestions.length],
      ).flatMap((item) => (item ? [item] : []))
    : [];
  const selectedPlan = draft.plan?.status === "ready" ? draft.plan : undefined;
  const selectedMaterialListed = materials?.materials.some(
    (item) => item.revisionId === draft.material?.revisionId,
  );
  return (
    <Page title={t("ninaHome.title")} refresh={{ onRefresh: refresh, busy: refreshing }}>
      {error && <OperationError error={error} />}
      {launch.error && <OperationError error={launch.error} />}
      <Card as="section" className={styles.request}>
        <h2>{t("ninaHome.heading")}</h2>
        <p>{t("ninaHome.intro")}</p>
        <TextAreaField
          label={t("ninaHome.request")}
          placeholder={t("ninaHome.placeholder")}
          value={draft.naturalRequest}
          maxLength={1800}
          rows={3}
          disabled={disabled}
          onChange={(event) => {
            edit({ naturalRequest: event.target.value });
          }}
        />
        <ActionGroup>
          {(["reading", "grammar", "writing"] as const).map((kind) => (
            <Button
              key={kind}
              variant="quiet"
              isDisabled={disabled}
              onPress={() => {
                edit({ naturalRequest: t(`ninaHome.examples.${kind}`) });
              }}
            >
              {t(`ninaHome.examples.${kind}`)}
            </Button>
          ))}
        </ActionGroup>
        <div className={styles.options}>
          <SelectField
            label={t("ninaHome.time")}
            description={t("ninaHome.timeHint")}
            value={draft.minutes}
            disabled={disabled}
            onChange={(event) => {
              edit({ minutes: event.target.value });
            }}
          >
            <option value="">{t("ninaHome.noTime")}</option>
            {[5, 10, 15, 20, 30, 60].map((count) => (
              <option key={count} value={count}>
                {t("ninaHome.minutes", { count })}
              </option>
            ))}
          </SelectField>
          <Disclosure label={t("ninaHome.material")}>
            <SelectField
              label={t("ninaHome.materialLabel")}
              description={t("ninaHome.materialHint")}
              value={draft.material?.revisionId ?? ""}
              disabled={disabled}
              onChange={(event) => {
                const material = materials?.materials.find(
                  (item) => item.revisionId === event.target.value,
                );
                edit({
                  material: material
                    ? { materialId: material.materialId, revisionId: material.revisionId }
                    : undefined,
                  materialTitle: material?.title,
                });
              }}
            >
              <option value="">{t("ninaHome.noMaterial")}</option>
              {draft.material && !selectedMaterialListed && (
                <option value={draft.material.revisionId}>
                  {draft.materialTitle ?? t("ninaHome.savedRevision")}
                </option>
              )}
              {materials?.materials.map((material) => (
                <option key={material.revisionId} value={material.revisionId}>
                  {material.title}
                </option>
              ))}
            </SelectField>
            {materials?.nextCursor && (
              <Button isDisabled={disabled} onPress={() => void moreMaterials()}>
                {t("ninaHome.moreMaterials")}
              </Button>
            )}
            {!materials?.materials.length && <p>{t("ninaHome.emptyMaterials")}</p>}
          </Disclosure>
        </div>
        <ActionGroup>
          <Button
            variant="primary"
            isDisabled={disabled || !snapshot || !draft.naturalRequest.trim()}
            onPress={() => void plan()}
          >
            {t("ninaHome.plan")}
          </Button>
        </ActionGroup>
      </Card>
      {draft.plan?.status === "clarification" && (
        <Card as="section" className={styles.summary}>
          <h2 ref={planHeading} tabIndex={-1}>
            {t("ninaHome.clarification")}
          </h2>
          <p>{draft.material ? t("ninaHome.materialHint") : t("ninaHome.supported")}</p>
          <ActionGroup>
            {ninaPracticeKindSchema.options
              .filter((kind) => !draft.material || ["reading", "vocabulary-review"].includes(kind))
              .map((kind) => (
                <Button key={kind} isDisabled={disabled} onPress={() => void plan(kind)}>
                  {t(`ninaHome.kinds.${kind}`)}
                </Button>
              ))}
          </ActionGroup>
        </Card>
      )}
      {selectedPlan && (
        <Card as="section" className={styles.summary}>
          <h2 ref={planHeading} tabIndex={-1}>
            {selectedPlan.prepared?.title ?? t(`ninaHome.kinds.${selectedPlan.request.kind}`)}
          </h2>
          <p>
            {t(`ninaHome.tasks.${selectedPlan.request.kind}`, {
              request: selectedPlan.request.naturalRequest,
            })}
          </p>
          <Muted as="p">
            {t(selectedPlan.prepared ? "ninaHome.preparedReason" : "ninaHome.freshReason")}
          </Muted>
          <p>{t("ninaHome.estimate", { count: selectedPlan.request.estimatedMinutes })}</p>
          <p>
            {t("ninaHome.languages", {
              target: t(`languages.${selectedPlan.request.learningContext.targetLanguage}`),
              explanation: t(
                `languages.${selectedPlan.request.learningContext.explanationLanguage}`,
              ),
            })}
          </p>
          {selectedPlan.prepared && <p>{t("ninaHome.savedWording")}</p>}
          {unavailable && <p role="status">{t("ninaHome.unavailable")}</p>}
          <OperationProgress progress={operation.progress} />
          <ActionGroup>
            {selectedPlan.prepared && (
              <Button variant="primary" isDisabled={disabled} onPress={() => void start(true)}>
                {t("ninaHome.start")}
              </Button>
            )}
            <Button
              variant={selectedPlan.prepared ? "secondary" : "primary"}
              isDisabled={disabled}
              onPress={() => void start(false)}
            >
              {t("ninaHome.generate")}
            </Button>
            {operation.busy && <Button onPress={operation.cancel}>{t("actions.cancel")}</Button>}
          </ActionGroup>
        </Card>
      )}
      {!snapshot && !error && <LoadingState live>{t("dashboard.refreshing")}</LoadingState>}
      {snapshot && (
        <Card as="section" className={styles.summary}>
          <h2>{t("ninaHome.continue")}</h2>
          <p>{snapshot.resume?.title ?? t("ninaHome.noResume")}</p>
          {snapshot.resume && (
            <>
              <Muted as="p">{t("ninaHome.recent")}</Muted>
              <ActionGroup>
                <Button isDisabled={disabled} onPress={() => void resume()}>
                  {t("ninaHome.continue")}
                </Button>
              </ActionGroup>
            </>
          )}
        </Card>
      )}
      <section aria-labelledby="practice-next-heading" aria-busy={refreshing}>
        <SectionHeader>
          <h2 id="practice-next-heading">{t("suggestions.title")}</h2>
          <Button
            isDisabled={disabled || suggestions.length <= 3}
            onPress={() => {
              setOffset((value) => (value + 3) % suggestions.length);
            }}
          >
            {t("suggestions.more")}
          </Button>
        </SectionHeader>
        <div className={styles.suggestions}>
          {visible.map((suggestion) => (
            <PracticeSuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              progress={launch.starting === suggestion.id ? launch.progress : undefined}
              recommended={false}
              starting={launch.starting === suggestion.id}
              onCancel={launch.generating ? launch.cancel : undefined}
              disabled={disabled}
              onStart={() => void launch.start(suggestion)}
            />
          ))}
        </div>
      </section>
      <ActionGroup>
        <Button
          onPress={() => {
            onNavigate("practice");
          }}
        >
          {t("suggestions.choosePractice")}
        </Button>
        <Button
          onPress={() => {
            onNavigate("history");
          }}
        >
          {t("dashboard.openHistory")}
        </Button>
      </ActionGroup>
    </Page>
  );
}

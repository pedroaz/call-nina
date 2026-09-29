import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  materialDraftSchema,
  type ActivityId,
  type CallNinaError,
  type DataRootGeneration,
  type DesktopIpcResponse,
  type MaterialDraft,
  type MaterialRevision,
  type ProviderOperation,
} from "@call-nina/contracts";
import { Button, Disclosure, FieldGroup, ItemList, Muted } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError, createDesktopSubmissionId } from "./ipc.js";
import { generatePracticeActivity, reusePracticeActivity } from "./generatePracticeActivity.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { useActivityLibrary } from "./useActivityLibrary.js";
import { OperationError } from "./Startup.js";
import { OperationProgress } from "./OperationProgress.js";
import styles from "./MaterialPractice.module.css";

type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "material/list" }>["result"];
type Draft = { kind: MaterialDraft["kind"]; title: string; text: string; source: string };
type PracticeType = "reading" | "vocabulary-review";
const emptyDraft: Draft = { kind: "pasted-text", title: "", text: "", source: "" };
const reference = (material: MaterialRevision) => ({
  materialId: material.materialId,
  revisionId: material.revisionId,
});

/** Supporting source views, deliberately reachable only inside practice setup. */
export function MaterialPractice({
  practiceType,
  exerciseCount,
  targetLevel,
  countValid,
  disabled = false,
  onBusyChange,
  requestAiAccess,
  onOpenActivity,
}: {
  practiceType: PracticeType;
  exerciseCount: number;
  targetLevel: "a1" | "a2" | "b1" | "b2";
  countValid: boolean;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (id: ActivityId) => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selected, setSelected] = useState<MaterialRevision>();
  const [view, setView] = useState<"list" | "detail" | "edit">("list");
  // Cancelling the editor only hides it; each material retains its own unsaved draft.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<CallNinaError>();
  const [localBusy, setLocalBusy] = useState(false);
  const generation = useLearningOperation();
  const busy = localBusy || generation.busy;
  const locked = disabled || busy;
  const heading = useRef<HTMLHeadingElement>(null);
  const key = selected?.revisionId ?? "new";
  const draft =
    drafts[key] ??
    (selected
      ? {
          kind: selected.kind,
          title: selected.title,
          text: selected.text,
          source: selected.source?.url ?? "",
        }
      : emptyDraft);
  const value = snapshot
    ? materialDraftSchema.safeParse({
        kind: draft.kind,
        title: draft.title,
        text: draft.text,
        language: snapshot.language,
        ...(draft.source ? { source: { url: draft.source } } : {}),
      })
    : undefined;
  const navigate = (next: typeof view) => {
    setView(next);
    window.requestAnimationFrame(() => heading.current?.focus());
  };
  const update = (patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...draft, ...patch } }));
  };
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  const refresh = async () => {
    setLocalBusy(true);
    setError(undefined);
    try {
      setSnapshot(await invokeDesktop("material/list", {}));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLocalBusy(false);
    }
  };
  const save = async () => {
    if (!snapshot || !value?.success) return;
    setLocalBusy(true);
    setError(undefined);
    try {
      const { material } = await invokeDesktop("material/save", {
        rootGeneration: snapshot.rootGeneration,
        draft: value.data,
        ...(selected ? { previous: reference(selected) } : {}),
      });
      setSnapshot({
        ...snapshot,
        materials: [
          material,
          ...snapshot.materials.filter((entry) => entry.materialId !== material.materialId),
        ].slice(0, 100),
      });
      setDrafts((current) => {
        return Object.fromEntries(Object.entries(current).filter(([draftKey]) => draftKey !== key));
      });
      setSelected(material);
      navigate("detail");
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLocalBusy(false);
    }
  };
  const generate = async () => {
    if (!selected || !snapshot || !countValid || !(await requestAiAccess("exercise-generation")))
      return;
    setError(undefined);
    try {
      onOpenActivity(
        await generatePracticeActivity(
          {
            source: "saved-material",
            practiceType,
            material: reference(selected),
            expectedGeneration: snapshot.rootGeneration,
            exerciseCount,
            targetLevel,
          },
          generation.run,
        ),
      );
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  };
  return (
    <Disclosure
      label={t(
        practiceType === "reading"
          ? "materialPractice.optional"
          : "materialPractice.optionalVocabulary",
      )}
    >
      <div className={styles.workspace}>
        <h3 tabIndex={-1} ref={heading}>
          {t(`materialPractice.${view}`)}
        </h3>
        {error && <OperationError error={error} />}
        {view === "list" && (
          <>
            <ActionGroup>
              <Button variant="secondary" isDisabled={locked} onPress={() => void refresh()}>
                {t("materialPractice.load")}
              </Button>
              <Button
                isDisabled={locked || !snapshot}
                onPress={() => {
                  setSelected(undefined);
                  navigate("edit");
                }}
              >
                {t("materialPractice.new")}
              </Button>
            </ActionGroup>
            {!snapshot && <Muted>{t("materialPractice.localHint")}</Muted>}
            {snapshot && (
              <>
                <Muted>
                  {t("materialPractice.language", {
                    language: t(`languages.${snapshot.language}`),
                  })}
                </Muted>
                {snapshot.materials.length === 0 && <Muted>{t("materialPractice.empty")}</Muted>}
                <ItemList>
                  {snapshot.materials.map((material) => (
                    <li key={material.materialId}>
                      <Button
                        variant="secondary"
                        isDisabled={locked}
                        onPress={() => {
                          setSelected(material);
                          navigate("detail");
                        }}
                      >
                        {material.title}
                      </Button>
                    </li>
                  ))}
                </ItemList>
              </>
            )}
          </>
        )}
        {view === "edit" && (
          <>
            <FieldGroup>
              {t("materialPractice.title")}
              <input
                maxLength={160}
                value={draft.title}
                disabled={locked}
                onChange={(event) => {
                  update({ title: event.target.value });
                }}
              />
            </FieldGroup>
            <FieldGroup>
              {t("materialPractice.kind")}
              <select
                value={draft.kind}
                disabled={locked}
                onChange={(event) => {
                  update({ kind: event.target.value as Draft["kind"] });
                }}
              >
                <option value="topic">{t("materialPractice.topic")}</option>
                <option value="pasted-text">{t("materialPractice.passage")}</option>
              </select>
            </FieldGroup>
            <FieldGroup>
              {t(`materialPractice.${draft.kind === "topic" ? "topic" : "passage"}`)}
              <textarea
                rows={8}
                maxLength={12000}
                value={draft.text}
                disabled={locked}
                onChange={(event) => {
                  update({ text: event.target.value });
                }}
              />
            </FieldGroup>
            <FieldGroup>
              {t("materialPractice.source")}
              <input
                type="url"
                maxLength={2000}
                value={draft.source}
                disabled={locked}
                onChange={(event) => {
                  update({ source: event.target.value });
                }}
              />
            </FieldGroup>
            <Muted>{t("materialPractice.sourceHint")}</Muted>
            <Muted>{t("materialPractice.preserve")}</Muted>
            <ActionGroup>
              <Button isDisabled={locked || !value?.success} onPress={() => void save()}>
                {t("materialPractice.save")}
              </Button>
              <Button
                variant="secondary"
                isDisabled={locked}
                onPress={() => {
                  navigate(selected ? "detail" : "list");
                }}
              >
                {t("actions.cancel")}
              </Button>
            </ActionGroup>
          </>
        )}
        {view === "detail" && selected && snapshot && (
          <>
            <h4>{selected.title}</h4>
            <Muted>
              {t("materialPractice.revision", {
                revision: selected.revision,
                language: t(`languages.${selected.language}`),
              })}
            </Muted>
            <p className={styles.source} lang={selected.language}>
              {selected.text}
            </p>
            {selected.source && (
              <p className={styles.reference}>
                {t("materialPractice.source")}: {selected.source.url}
              </p>
            )}
            <ActionGroup>
              <Button
                variant="secondary"
                isDisabled={locked}
                onPress={() => {
                  navigate("list");
                }}
              >
                {t("materialPractice.back")}
              </Button>
              <Button
                variant="secondary"
                isDisabled={locked}
                onPress={() => {
                  navigate("edit");
                }}
              >
                {t("materialPractice.edit")}
              </Button>
              <Button isDisabled={locked || !countValid} onPress={() => void generate()}>
                {t(
                  practiceType === "reading"
                    ? "materialPractice.generateReading"
                    : "materialPractice.generateVocabulary",
                  { count: exerciseCount },
                )}
              </Button>
              {generation.busy && (
                <Button variant="secondary" onPress={generation.cancel}>
                  {t("actions.cancel")}
                </Button>
              )}
            </ActionGroup>
            <OperationProgress progress={generation.progress} />
            <RelatedPractice
              key={selected.revisionId}
              material={selected}
              practiceType={practiceType}
              rootGeneration={snapshot.rootGeneration}
              disabled={locked}
              onOpenActivity={onOpenActivity}
              onBusyChange={setLocalBusy}
            />
          </>
        )}
      </div>
    </Disclosure>
  );
}

function RelatedPractice({
  material,
  practiceType,
  rootGeneration,
  disabled,
  onOpenActivity,
  onBusyChange,
}: {
  material: MaterialRevision;
  practiceType: PracticeType;
  rootGeneration: DataRootGeneration;
  disabled: boolean;
  onOpenActivity: (id: ActivityId) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const library = useActivityLibrary([practiceType], true, reference(material));
  const [error, setError] = useState<CallNinaError>();
  const visibleError = error ?? library.error;
  const launchIds = useRef(new Map<ActivityId, ReturnType<typeof createDesktopSubmissionId>>());
  const open = async (activityId: ActivityId) => {
    onBusyChange(true);
    setError(undefined);
    try {
      const prepared = await invokeDesktop("prepared-activity/read", { activityId });
      let launchId = launchIds.current.get(activityId);
      if (!launchId) {
        launchId = createDesktopSubmissionId();
        launchIds.current.set(activityId, launchId);
      }
      onOpenActivity(
        await reusePracticeActivity(
          {
            activityId,
            content: prepared.content,
            context: { origin: "materials" },
            expectedGeneration: rootGeneration,
          },
          launchId,
        ),
      );
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      onBusyChange(false);
    }
  };
  return (
    <section className={styles.workspace}>
      <h4>{t("materialPractice.related")}</h4>
      <Muted>{t("materialPractice.relatedHint")}</Muted>
      {visibleError && <OperationError error={visibleError} />}
      {library.loaded && library.entries.length === 0 && (
        <Muted>{t("materialPractice.noRelated")}</Muted>
      )}
      <ItemList>
        {library.entries.map((entry) => (
          <li key={entry.activityId}>
            <Button
              variant="secondary"
              isDisabled={disabled}
              onPress={() => void open(entry.activityId)}
            >
              {t("materialPractice.open", { title: entry.title })}
            </Button>
          </li>
        ))}
      </ItemList>
      <ActionGroup>
        <Button
          variant="secondary"
          isDisabled={disabled || library.busy}
          onPress={() => void library.refresh()}
        >
          {t("materialPractice.refresh")}
        </Button>
        {library.hasMore && (
          <Button isDisabled={disabled || library.busy} onPress={() => void library.loadMore()}>
            {t("materialPractice.more")}
          </Button>
        )}
      </ActionGroup>
    </section>
  );
}

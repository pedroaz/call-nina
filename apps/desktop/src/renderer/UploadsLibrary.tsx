import { useUploads, UploadPreview, uploadReference as reference } from "./useUploads.js";
import { useEffect, useRef, useState } from "react";
import { BookPlus, FileText, Globe, Image, ImagePlus, Pencil, ScanText } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  vocabularyAnalysisOutputSchema,
  websiteStudyPackOutputSchema,
  type WebsiteSource,
  type z,
  materialSourceSchema,
  type UploadDetail,
  type UploadDraft,
  type UploadImageInput,
  type UploadSummary,
  type PracticeSource,
  type ProviderOperation,
  type CallNinaError,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import {
  invokeDesktop,
  normalizeDesktopError,
  createDesktopSubmissionId,
  subscribeDesktop,
} from "./ipc.js";
import { openProviderSettingsEvent } from "./ProviderActionSummary.js";
import {
  Button,
  IconButton,
  EmptyState,
  ModalDialog,
  TextField,
  TextAreaField,
  FileTrigger,
  ToggleButtonGroup,
  Feedback,
  LoadingState,
} from "./components/ui/index.js";
import { ActionGroup, ContentRow } from "./components/layout/index.js";
import { OperationError } from "./OperationError.js";
import { OperationProgress } from "./OperationProgress.js";
import { VocabularyDetails } from "./VocabularyDetails.js";
import { UploadStudyItems } from "./UploadStudyItems.js";
import { useLearningOperation } from "./useLearningOperation.js";
import styles from "./UploadsLibrary.module.css";

export function UploadsLibrary({
  requestAiAccess,
  onBusyChange,
  onPractise,
  onAddContent,
  openAdd = 0,
  onWordNavigate,
}: {
  requestAiAccess: (
    operation: ProviderOperation,
    previous?: undefined,
    hasImage?: boolean,
  ) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  onPractise: (source: PracticeSource) => void;
  onAddContent: () => void;
  onWordNavigate: (
    page: "results" | "practice",
    scope?: import("./savedResultsTypes.js").SavedResultsScope,
  ) => void;
  openAdd?: number;
  onOpenActivity: (id: import("@call-nina/contracts").ActivityId) => void;
}) {
  const { t } = useTranslation();
  const library = useUploads();
  const { snapshot } = library;
  const [selected, setSelected] = useState<UploadDetail>(),
    [renaming, setRenaming] = useState<{ revisionId: string; title: string }>(),
    [editor, setEditor] = useState(false),
    [editing, setEditing] = useState<UploadDetail>(),
    [draft, setDraft] = useState<UploadDraft>({ format: "text", title: "", text: "" }),
    [error, setError] = useState<CallNinaError>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [truncated, setTruncated] = useState(false),
    [original, setOriginal] = useState<UploadImageInput>();
  const [analyses, setAnalyses] = useState<
      Extract<
        DesktopIpcResponse,
        { status: "ok"; channel: "uploads/analyses" }
      >["result"]["analyses"]
    >([]),
    [positions, setPositions] = useState<number[]>([]);
  const [savedWords, setSavedWords] = useState<
      Extract<DesktopIpcResponse, { status: "ok"; channel: "vocabulary/read" }>["result"]["entries"]
    >([]),
    [wordId, setWordId] = useState<import("@call-nina/contracts").VocabularyId>();
  type WebsitePreview = {
    operationId: ReturnType<typeof createDesktopSubmissionId>;
    source: WebsiteSource;
    output: z.infer<typeof websiteStudyPackOutputSchema>;
    positions: number[];
  };
  const [websitePreview, setWebsitePreview] = useState<WebsitePreview>();
  const formatDrafts = useRef(new Map<UploadDraft["format"], UploadDraft>());
  const formatWebsitePreview = useRef<WebsitePreview | undefined>(undefined);
  const [readingWebsite, setReadingWebsite] = useState(false);
  const [importAccessError, setImportAccessError] = useState<string>();
  const [imageAccess, setImageAccess] = useState<"checking" | "available" | "unavailable">(
    "checking",
  );
  useEffect(() => {
    if (!editor || draft.format !== "image") return;
    let live = true;
    let serial = 0;
    const refresh = async () => {
      const ticket = ++serial;
      setImageAccess("checking");
      try {
        const access = await invokeDesktop("provider/access/read", {
          operation: "vocabulary-analysis",
          hasImage: true,
        });
        if (live && ticket === serial)
          setImageAccess(access.status === "unavailable" ? "unavailable" : "available");
      } catch {
        if (live && ticket === serial) setImageAccess("unavailable");
      }
    };
    void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "data-root-changed" ||
        (event.event === "state-invalidated" && ["ai-connections", "account"].includes(event.scope))
      )
        void refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [editor, draft.format]);
  const checkImportAccess = async (operation: ProviderOperation, hasImage = false) => {
    setImportAccessError(undefined);
    const access = await invokeDesktop("provider/access/read", { operation, hasImage });
    if (access.status === "unavailable") {
      setImportAccessError(`providerAccess.reasons.${access.reason}`);
      return false;
    }
    return requestAiAccess(operation, undefined, hasImage);
  };
  const readingId = useRef<ReturnType<typeof createDesktopSubmissionId> | undefined>(undefined);
  const websiteDraftCache = useRef(new Map<string, WebsitePreview>());
  const operation = useLearningOperation(),
    epoch = useRef(0),
    locked = useRef(false);
  const saveSubmission = useRef<
    { fingerprint: string; id: ReturnType<typeof createDesktopSubmissionId> } | undefined
  >(undefined);
  const draftCache = useRef(new Map<string, UploadDraft>());
  const rememberDraft = () => {
    const key = editing?.revisionId ?? "new";
    draftCache.current.set(key, draft);
    if (websitePreview) websiteDraftCache.current.set(key, websitePreview);
    else websiteDraftCache.current.delete(key);
  };
  const cancelWebsite = () => {
    if (readingId.current)
      void invokeDesktop("material/cancel-import", { importId: readingId.current }).catch(
        () => undefined,
      );
    readingId.current = undefined;
    operation.cancel();
  };
  const working = busy || operation.busy;
  const scope = `${snapshot?.rootGeneration ?? ""}:${snapshot?.language ?? ""}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [seenAdd, setSeenAdd] = useState(0);
  useEffect(() => {
    if (openAdd !== seenAdd) {
      setSeenAdd(openAdd);
      rememberDraft();
      const next: UploadDraft = draftCache.current.get("new") ?? {
        format: "text" as const,
        title: "",
        text: "",
      };
      setDraft(next);
      setWebsitePreview(websiteDraftCache.current.get("new"));
      setOriginal(next.image);
      setEditor(true);
      setEditing(undefined);
    }
  }, [openAdd, seenAdd]);
  useEffect(() => {
    epoch.current++;
    cancelWebsite();
    draftCache.current.clear();
    formatDrafts.current.clear();
    formatWebsitePreview.current = undefined;
    websiteDraftCache.current.clear();
    setWebsitePreview(undefined);
    setReadingWebsite(false);
    setTruncated(false);
    locked.current = false;
    setBusy(false);
    setWordId(undefined);
    setSelected(undefined);
    setRenaming(undefined);
    setEditing(undefined);
    setEditor(openAdd > 0 && seenAdd === 0);
    setDraft({ format: "text", title: "", text: "" });
    setOriginal(undefined);
    setAnalyses([]);
    setError(undefined);
  }, [scope]);
  useEffect(
    () => () => {
      if (readingId.current)
        void invokeDesktop("material/cancel-import", { importId: readingId.current }).catch(
          () => undefined,
        );
    },
    [],
  );
  useEffect(() => {
    onBusyChange(working || editor || Boolean(selected));
    return () => onBusyChange(false);
  }, [working, editor, selected, onBusyChange]);
  const safely = async (action: () => Promise<void>) => {
    if (locked.current) return;
    const captured = epoch.current;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      await action();
    } catch (e) {
      if (epoch.current === captured) setError(normalizeDesktopError(e).detail);
    } finally {
      if (epoch.current === captured) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const open = async (item: UploadSummary) => {
    const captured = scopeRef.current;
    await safely(async () => {
      const result = await invokeDesktop("uploads/read", {
        rootGeneration: snapshot!.rootGeneration,
        reference: reference(item),
      });
      if (captured !== scopeRef.current) return;
      setSelected(result.upload);
      setAnalyses([]);
      setSavedWords(result.words);
      const proposals = await invokeDesktop("uploads/analyses", {
        rootGeneration: snapshot!.rootGeneration,
        reference: reference(item),
      });
      if (captured !== scopeRef.current) return;
      setAnalyses(proposals.analyses);
      setPositions(proposals.analyses[0]?.output.words.map((_, i) => i) ?? []);
    });
  };
  const acceptImage = async (file: File | undefined) => {
    if (!file) return;
    const captured = epoch.current;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setMessage("uploads.imageInvalid");
      return;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result.split(",")[1] ?? "")
          : reject(new Error("OD_IMAGE_INVALID"));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = { mediaType: file.type as UploadImageInput["mediaType"], data };
    if (captured !== epoch.current) return;
    setOriginal(image);
    setDraft((d) => ({ ...d, image, title: d.title || file.name.slice(0, 160) }));
  };
  const analyse = async (preview = false) => {
    if (!snapshot) return;
    await safely(async () => {
      if (
        !(await (preview
          ? checkImportAccess("vocabulary-analysis", Boolean(original))
          : requestAiAccess(
              "vocabulary-analysis",
              undefined,
              Boolean(preview ? original : selected?.image && !selected.hasText),
            )))
      )
        return;
      const captured = scopeRef.current;
      const result = await operation.run({
        kind: "vocabulary-analysis",
        rootGeneration: snapshot.rootGeneration,
        source:
          preview && original
            ? { kind: "preview", image: original }
            : { kind: "upload", reference: reference(selected!) },
      });
      if (captured !== scopeRef.current) return;
      const output = vocabularyAnalysisOutputSchema.parse(result.output);
      if (!output.readable) {
        setMessage("uploads.unreadable");
        return;
      }
      if (preview) {
        setDraft((d) => ({ ...d, text: output.extractedText }));
        return;
      }
      const proposals = await invokeDesktop("uploads/analyses", {
        rootGeneration: snapshot.rootGeneration,
        reference: reference(selected!),
      });
      if (captured !== scopeRef.current) return;
      setAnalyses(proposals.analyses);
      setPositions(proposals.analyses[0]?.output.words.map((_, i) => i) ?? []);
      if (!selected!.hasText && output.extractedText) {
        setEditing(selected);
        setDraft({
          format: selected!.format,
          title: selected!.title,
          text: output.extractedText,
          ...(selected!.url ? { url: selected!.url } : {}),
        });
        setEditor(true);
      }
    });
  };
  const proposal = analyses[0];
  return (
    <div className={styles.library}>
      {library.error && <OperationError error={library.error} />}
      {error && !editor && !selected && <OperationError error={error} />}
      {!snapshot && !library.error && <LoadingState>{t("ui.loading")}</LoadingState>}
      {snapshot?.uploads.length === 0 && !library.error && (
        <EmptyState
          variant="plain"
          icon={<BookPlus />}
          title={t("uploads.noUploads")}
          action={
            <Button
              variant="primary"
              isDisabled={working}
              leadingIcon={<BookPlus aria-hidden="true" />}
              onPress={onAddContent}
            >
              {t("uploads.add")}
            </Button>
          }
        />
      )}
      {snapshot?.uploads.map((upload) => (
        <ContentRow key={upload.uploadId} className={styles.uploadRow}>
          <Button
            variant="quiet"
            className={styles.uploadOpen}
            isDisabled={working}
            aria-label={`${t("uploads.open")}: ${upload.title}`}
            onPress={() => void open(upload)}
          >
            <span aria-hidden="true" className={styles.uploadIcon}>
              {upload.format === "image" ? (
                <Image />
              ) : upload.format === "website" ? (
                <Globe />
              ) : (
                <FileText />
              )}
            </span>
            <span className={styles.uploadCopy}>
              <strong>{upload.title}</strong>
              <span className={styles.meta}>
                {t(`uploads.formats.${upload.format}`)}
                {upload.url ? ` · ${new URL(upload.url).hostname}` : ""} ·{" "}
                {new Date(upload.createdAt).toLocaleDateString()}
              </span>
            </span>
          </Button>
        </ContentRow>
      ))}
      {selected && snapshot && (
        <ModalDialog
          isOpen={!editor}
          isDismissable={!working}
          title={selected.title}
          titleAction={
            <IconButton
              variant="quiet"
              label={t("uploads.rename")}
              leadingIcon={<Pencil aria-hidden="true" />}
              isDisabled={working || selected.archived}
              onPress={() =>
                setRenaming({ revisionId: selected.revisionId, title: selected.title })
              }
            />
          }
          closeLabel={t("actions.close")}
          onOpenChange={(v) => {
            if (!v && !working) setSelected(undefined);
          }}
        >
          {renaming?.revisionId === selected.revisionId && (
            <form
              className={styles.preview}
              onSubmit={(event) => {
                event.preventDefault();
                if (!renaming.title.trim() || renaming.title.trim() === selected.title) return;
                void safely(async () => {
                  const captured = scopeRef.current;
                  const draft: UploadDraft = {
                    format: selected.format,
                    title: renaming.title,
                    text: selected.text,
                    ...(selected.url ? { url: selected.url } : {}),
                  };
                  const fingerprint = JSON.stringify({
                    draft,
                    previous: selected.revisionId,
                    scope,
                  });
                  if (saveSubmission.current?.fingerprint !== fingerprint)
                    saveSubmission.current = { fingerprint, id: createDesktopSubmissionId() };
                  const result = await invokeDesktop("uploads/save", {
                    saveId: saveSubmission.current!.id,
                    rootGeneration: snapshot.rootGeneration,
                    language: snapshot.language,
                    previous: reference(selected),
                    draft,
                  });
                  if (captured !== scopeRef.current) return;
                  setSelected(result.upload);
                  setRenaming(undefined);
                  setAnalyses([]);
                  const detail = await invokeDesktop("uploads/read", {
                    rootGeneration: snapshot.rootGeneration,
                    reference: reference(result.upload),
                  });
                  if (captured !== scopeRef.current) return;
                  setSavedWords(detail.words);
                  await library.refresh();
                });
              }}
            >
              <TextField
                autoFocus
                label={t("uploads.title")}
                value={renaming.title}
                maxLength={160}
                required
                disabled={working}
                onChange={(event) => setRenaming({ ...renaming, title: event.target.value })}
              />
              <ActionGroup align="end">
                <Button
                  variant="secondary"
                  isDisabled={working}
                  onPress={() => setRenaming(undefined)}
                >
                  {t("actions.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isPending={working}
                  isDisabled={!renaming.title.trim() || renaming.title.trim() === selected.title}
                >
                  {t("vocabulary.learning.save")}
                </Button>
              </ActionGroup>
            </form>
          )}
          <UploadPreview upload={selected} rootGeneration={snapshot.rootGeneration} />
          <ActionGroup>
            <Button
              variant="secondary"
              isDisabled={working || selected.archived}
              onPress={() => {
                rememberDraft();
                setEditing(selected);
                setWebsitePreview(websiteDraftCache.current.get(selected.revisionId));
                setDraft(
                  draftCache.current.get(selected.revisionId) ?? {
                    format: selected.format,
                    title: selected.title,
                    text: selected.text,
                    ...(selected.url ? { url: selected.url } : {}),
                  },
                );
                setOriginal(undefined);
                if (selected.image)
                  void safely(async () => {
                    const image = await invokeDesktop("uploads/image", {
                      rootGeneration: snapshot.rootGeneration,
                      reference: reference(selected),
                    });
                    if (image.image) setOriginal(image.image);
                  });
                setEditor(true);
              }}
            >
              {t("uploads.edit")}
            </Button>
            <Button
              variant="secondary"
              isPending={working}
              isDisabled={selected.archived}
              onPress={() => void analyse()}
            >
              {t("uploads.extract")}
            </Button>
            <Button
              variant="primary"
              isDisabled={!selected.hasText || selected.archived || working}
              onPress={() => {
                setSelected(undefined);
                onPractise({
                  kind: "upload",
                  reference: reference(selected),
                  rootGeneration: snapshot.rootGeneration,
                });
              }}
            >
              {t("uploads.practise")}
            </Button>
          </ActionGroup>
          {!selected.hasText && <Feedback live="polite">{t("uploads.textRequired")}</Feedback>}
          <OperationProgress progress={operation.progress} />
          {operation.busy && (
            <Button variant="secondary" onPress={operation.cancel}>
              {t("actions.cancel")}
            </Button>
          )}
          {error && <OperationError error={error} />}{" "}
          {message && (
            <Feedback live="polite" tone="error">
              {t(message)}
            </Feedback>
          )}
          {proposal && (
            <section className={styles.proposals}>
              <h3>{t("uploads.proposals")}</h3>
              {proposal.output.words.map((word, i) => (
                <label key={i} className={styles.proposal}>
                  <input
                    type="checkbox"
                    checked={positions.includes(i)}
                    disabled={working}
                    onChange={(e) =>
                      setPositions((p) => (e.target.checked ? [...p, i] : p.filter((n) => n !== i)))
                    }
                  />
                  <span>
                    <strong>{word.lemma}</strong> · {word.meaning}
                    {word.examples.map((example, n) => (
                      <p key={n} lang={selected.language}>
                        {example.text}
                      </p>
                    ))}
                  </span>
                </label>
              ))}
              <Button
                variant="primary"
                isDisabled={working || !positions.length}
                onPress={() =>
                  void safely(async () => {
                    await invokeDesktop("uploads/commit", {
                      rootGeneration: snapshot.rootGeneration,
                      analysisId: proposal.analysisId,
                      positions,
                    });
                    setAnalyses([]);
                    setPositions([]);
                    const updated = await invokeDesktop("uploads/read", {
                      rootGeneration: snapshot.rootGeneration,
                      reference: reference(selected),
                    });
                    setSelected(updated.upload);
                    setSavedWords(updated.words);
                    await library.refresh();
                  })
                }
              >
                {t("uploads.saveSelected", { count: positions.length })}
              </Button>
            </section>
          )}
          <UploadStudyItems
            items={selected.items}
            language={selected.language}
            sourceFormat={selected.format}
          />
          {!!savedWords.length && (
            <section>
              <h3>{t("uploads.extractedWords")}</h3>
              {savedWords.map((word) => (
                <Button
                  key={word.vocabularyId}
                  variant="quiet"
                  onPress={() => setWordId(word.vocabularyId)}
                >
                  {word.lemma} · {word.meaning}
                </Button>
              ))}
            </section>
          )}
          <Button
            variant="danger"
            isDisabled={working || selected.archived}
            onPress={() =>
              void safely(async () => {
                await invokeDesktop("uploads/archive", {
                  rootGeneration: snapshot.rootGeneration,
                  reference: reference(selected),
                });
                setSelected(undefined);
                await library.refresh();
              })
            }
          >
            {t("uploads.remove")}
          </Button>
        </ModalDialog>
      )}
      <ModalDialog
        isOpen={editor}
        size="form"
        isDismissable={!working}
        title={t(editing ? "uploads.edit" : "uploads.add")}
        closeLabel={t("actions.close")}
        onOpenChange={setEditor}
      >
        <div className={styles.form}>
          {!editing && (
            <ToggleButtonGroup label={t("uploads.format")}>
              {(["text", "website", "image"] as const).map((format) => (
                <Button
                  key={format}
                  variant="secondary"
                  aria-pressed={draft.format === format}
                  isDisabled={working}
                  onPress={() => {
                    if (draft.format === format) return;
                    if (format === "image") setImageAccess("checking");
                    setError(undefined);
                    setImportAccessError(undefined);
                    setMessage("");
                    formatDrafts.current.set(draft.format, draft);
                    if (draft.format === "website") formatWebsitePreview.current = websitePreview;
                    const next = formatDrafts.current.get(format) ?? {
                      format,
                      title: "",
                      text: "",
                    };
                    setWebsitePreview(
                      format === "website" ? formatWebsitePreview.current : undefined,
                    );
                    setOriginal(next.image);
                    setTruncated(false);
                    setDraft(next);
                  }}
                >
                  {t(`uploads.formats.${format}`)}
                </Button>
              ))}
            </ToggleButtonGroup>
          )}
          {draft.format === "website" && (
            <>
              <TextField
                disabled={working}
                label={t("uploads.url")}
                type="url"
                value={draft.url ?? ""}
                maxLength={2000}
                onChange={(e) => {
                  setWebsitePreview(undefined);
                  setTruncated(false);
                  setDraft((d) => ({ ...d, url: e.target.value, text: "", title: "" }));
                }}
              />
              <Button
                variant="secondary"
                isPending={working}
                className={styles.sourceAction}
                isDisabled={!draft.url || !snapshot}
                onPress={() =>
                  void safely(async () => {
                    if (!materialSourceSchema.shape.url.safeParse(draft.url).success) {
                      setMessage("uploads.websiteInvalid");
                      return;
                    }
                    if (!(await checkImportAccess("website-study-pack"))) return;
                    const captured = scopeRef.current;
                    const importId = createDesktopSubmissionId();
                    readingId.current = importId;
                    setReadingWebsite(true);
                    try {
                      const capture = await invokeDesktop("material/import-web", {
                        rootGeneration: snapshot!.rootGeneration,
                        language: snapshot!.language,
                        url: draft.url!,
                        importId,
                      });
                      if (captured !== scopeRef.current || readingId.current !== importId) return;
                      readingId.current = undefined;
                      setReadingWebsite(false);
                      const result = await operation.run({
                        kind: "website-study-pack",
                        rootGeneration: snapshot!.rootGeneration,
                        captureId: capture.captureId,
                      });
                      if (captured !== scopeRef.current) return;
                      const output = websiteStudyPackOutputSchema.parse(result.output);
                      setWebsitePreview({
                        operationId: result.operationId,
                        source: capture.source,
                        output,
                        positions: output.items.map((_, i) => i),
                      });
                      setDraft((d) => ({
                        ...d,
                        title: output.title,
                        text: output.summary,
                        url: capture.source.url,
                      }));
                      setTruncated(capture.source.truncated);
                    } finally {
                      if (captured === scopeRef.current) {
                        readingId.current = undefined;
                        setReadingWebsite(false);
                      }
                    }
                  })
                }
              >
                {t("uploads.import")}
              </Button>
            </>
          )}
          {draft.format === "image" &&
            imageAccess !== "available" &&
            (imageAccess === "checking" ? (
              <LoadingState>{t("providers.checkingConnection")}</LoadingState>
            ) : (
              <div className={styles.imageInput}>
                <p>{t("uploads.configureImageReading")}</p>
                <Button
                  variant="primary"
                  className={styles.sourceAction}
                  onPress={() => {
                    rememberDraft();
                    setEditor(false);
                    window.dispatchEvent(new Event(openProviderSettingsEvent));
                  }}
                >
                  {t("uploads.configureNow")}
                </Button>
              </div>
            ))}
          {draft.format === "image" && imageAccess === "available" && (
            <div className={styles.imageInput}>
              {original && (
                <img
                  className={styles.image}
                  src={`data:${original.mediaType};base64,${original.data}`}
                  alt={draft.title}
                />
              )}
              <ActionGroup {...(!original ? { className: styles.imageChooser } : {})}>
                <FileTrigger
                  acceptedFileTypes={["image/png", "image/jpeg", "image/webp"]}
                  onSelect={(files) => {
                    const file = files?.[0];
                    if (file) void safely(() => acceptImage(file));
                  }}
                >
                  <Button
                    variant="secondary"
                    {...(!original ? { className: styles.chooseImage } : {})}
                    leadingIcon={<ImagePlus aria-hidden="true" />}
                    isDisabled={working}
                  >
                    {t(original || editing?.image ? "uploads.replaceImage" : "uploads.chooseImage")}
                  </Button>
                </FileTrigger>
                {original && (
                  <Button
                    variant="primary"
                    leadingIcon={<ScanText aria-hidden="true" />}
                    isDisabled={working}
                    onPress={() => {
                      if (imageAccess !== "available") {
                        rememberDraft();
                        setEditor(false);
                        window.dispatchEvent(new Event(openProviderSettingsEvent));
                        return;
                      }
                      void analyse(true);
                    }}
                  >
                    {t("uploads.readImage")}
                  </Button>
                )}
              </ActionGroup>
            </div>
          )}
          {importAccessError && (
            <span className={styles.importError} role="alert">
              {t(importAccessError)}
            </span>
          )}
          {(draft.format === "text" ||
            (draft.format === "image" &&
              imageAccess === "available" &&
              Boolean(original || editing?.image)) ||
            (draft.format === "website" && Boolean(websitePreview || editing))) && (
            <>
              <TextField
                disabled={working}
                label={t("uploads.title")}
                value={draft.title}
                maxLength={160}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <TextAreaField
                disabled={working}
                label={t(draft.format === "website" ? "uploads.summary" : "uploads.text")}
                value={draft.text}
                rows={6}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, text: e.target.value }));
                  setMessage(e.target.value.length > 12000 ? "uploads.textLimit" : "");
                }}
              />
              <span className={styles.meta}>{draft.text.length.toLocaleString()} / 12,000</span>
            </>
          )}
          {websitePreview && snapshot && (
            <>
              <UploadStudyItems
                items={websitePreview.output.items}
                language={snapshot.language}
                positions={websitePreview.positions}
                disabled={working}
                onSelectionChange={(positions) =>
                  setWebsitePreview((p) => (p ? { ...p, positions } : p))
                }
              />
              <details className={styles.secondary}>
                <summary>{t("uploads.originalText")}</summary>
                <div className={styles.sourceText}>{websitePreview.source.text}</div>
              </details>
            </>
          )}
          {truncated && <Feedback live="polite">{t("uploads.truncated")}</Feedback>}
          {error && <OperationError error={error} />}{" "}
          {message && (
            <Feedback live="polite" tone="error">
              {t(message)}
            </Feedback>
          )}
          {readingWebsite && <LoadingState>{t("uploads.readingWebsite")}</LoadingState>}
          <OperationProgress progress={operation.progress} />
          {(operation.busy || readingWebsite) && (
            <Button variant="secondary" onPress={cancelWebsite}>
              {t("actions.cancel")}
            </Button>
          )}
          <ActionGroup align="end">
            <Button variant="secondary" isDisabled={working} onPress={() => setEditor(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              variant="primary"
              isPending={working}
              isDisabled={
                !snapshot ||
                (draft.format === "image" && imageAccess !== "available") ||
                !draft.title.trim() ||
                draft.text.length > 12000 ||
                (draft.format === "website" &&
                  (!materialSourceSchema.shape.url.safeParse(draft.url).success ||
                    (!websitePreview && (!editing || editing.url !== draft.url)))) ||
                (draft.format !== "image" && !draft.text.trim()) ||
                (draft.format === "image" && !draft.image && !editing?.image)
              }
              onPress={() =>
                void safely(async () => {
                  const captured = scopeRef.current;
                  const fingerprint = JSON.stringify({
                    draft,
                    previous: editing?.revisionId,
                    websitePack: websitePreview
                      ? {
                          operationId: websitePreview.operationId,
                          positions: websitePreview.positions,
                        }
                      : undefined,
                    scope,
                  });
                  if (saveSubmission.current?.fingerprint !== fingerprint)
                    saveSubmission.current = { fingerprint, id: createDesktopSubmissionId() };
                  const result = await invokeDesktop("uploads/save", {
                    saveId: saveSubmission.current!.id,
                    rootGeneration: snapshot!.rootGeneration,
                    language: snapshot!.language,
                    draft: {
                      ...draft,
                      ...(draft.format !== "image" ? { image: undefined } : {}),
                      ...(draft.format !== "website" ? { url: undefined } : {}),
                    },
                    ...(editing ? { previous: reference(editing) } : {}),
                    ...(draft.format === "website" && websitePreview
                      ? {
                          websitePack: {
                            operationId: websitePreview.operationId,
                            positions: websitePreview.positions,
                          },
                        }
                      : {}),
                  });
                  if (captured !== scopeRef.current) return;
                  setSelected(result.upload);
                  draftCache.current.delete(editing?.revisionId ?? "new");
                  websiteDraftCache.current.delete(editing?.revisionId ?? "new");
                  setWebsitePreview(undefined);
                  setTruncated(false);
                  const detail = await invokeDesktop("uploads/read", {
                    rootGeneration: snapshot!.rootGeneration,
                    reference: reference(result.upload),
                  });
                  if (captured !== scopeRef.current) return;
                  setSavedWords(detail.words);
                  setEditor(false);
                  setEditing(undefined);
                  setDraft({ format: "text", title: "", text: "" });
                  setOriginal(undefined);
                  setAnalyses([]);
                  await library.refresh();
                })
              }
            >
              {t("vocabulary.learning.save")}
            </Button>
          </ActionGroup>
        </div>
      </ModalDialog>
      {wordId && snapshot && (
        <VocabularyDetails
          vocabularyId={wordId}
          rootGeneration={snapshot.rootGeneration}
          onClose={() => setWordId(undefined)}
          onChanged={() => void library.refresh()}
          onNavigate={(page, scope) => {
            setWordId(undefined);
            setSelected(undefined);
            onWordNavigate(page, scope);
          }}
        />
      )}
    </div>
  );
}

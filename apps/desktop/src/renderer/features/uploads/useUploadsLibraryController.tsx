import {
  type VocabularyId,
  type CallNinaError,
  type DesktopIpcResponse,
  type ProviderOperation,
  type UploadDetail,
  type UploadDraft,
  type UploadImageInput,
  type UploadSummary,
  vocabularyAnalysisOutputSchema,
  type WebsiteSource,
  type websiteStudyPackOutputSchema,
  type z,
} from "@call-nina/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLearningOperation } from "../../learning/operations/useLearningOperation.js";
import { type UploadsLibraryProps } from "../../learning/uploads/UploadsLibrary.types.js";
import {
  uploadReference as reference,
  type useUploads,
} from "../../learning/uploads/useUploads.js";
import {
  type createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "../../runtime/ipc.js";

export function useUploadsLibraryController({
  library,
  requestAiAccess,
  onBusyChange,
  onPractise,
  onAddContent,
  openAdd = 0,
  onWordNavigate,
}: UploadsLibraryProps & { library: ReturnType<typeof useUploads> }) {
  const { t } = useTranslation();
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
    [wordId, setWordId] = useState<VocabularyId>();
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
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
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
  const rememberDraft = useCallback(() => {
    const key = editing?.revisionId ?? "new";
    draftCache.current.set(key, draft);
    if (websitePreview) websiteDraftCache.current.set(key, websitePreview);
    else websiteDraftCache.current.delete(key);
  }, [editing?.revisionId, draft, websitePreview]);
  const cancelWebsite = () => {
    if (readingId.current)
      void invokeDesktop("material/cancel-import", { importId: readingId.current }).catch(
        () => undefined,
      );
    readingId.current = undefined;
    operation.cancel();
  };
  const working = busy || operation.busy;
  const scope = JSON.stringify([snapshot?.rootGeneration, snapshot?.language]);
  const scopeRef = useRef<string | null>(scope);
  const [seenAdd, setSeenAdd] = useState(0);
  useEffect(() => {
    if (openAdd === seenAdd) return;
    const timer = window.setTimeout(() => {
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
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [openAdd, seenAdd, rememberDraft]);

  useEffect(() => {
    scopeRef.current = scope;
    return () => {
      scopeRef.current = null;
      epoch.current = epoch.current + 1;
      if (readingId.current)
        void invokeDesktop("material/cancel-import", { importId: readingId.current }).catch(
          () => undefined,
        );
    };
  }, [scope]);
  useEffect(() => {
    onBusyChange(working || editor || Boolean(selected));
    return () => {
      onBusyChange(false);
    };
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
    if (!snapshot) return;
    const captured = scopeRef.current;
    await safely(async () => {
      const result = await invokeDesktop("uploads/read", {
        rootGeneration: snapshot.rootGeneration,
        reference: reference(item),
      });
      if (captured !== scopeRef.current) return;
      setSelected(result.upload);
      setAnalyses([]);
      setSavedWords(result.words);
      const proposals = await invokeDesktop("uploads/analyses", {
        rootGeneration: snapshot.rootGeneration,
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
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result.split(",")[1] ?? "");
        else reject(new Error("OD_IMAGE_INVALID"));
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = { mediaType: file.type as UploadImageInput["mediaType"], data };
    if (captured !== epoch.current) return;
    setOriginal(image);
    setDraft((d) => ({ ...d, image, title: d.title || file.name.slice(0, 160) }));
  };
  const analyse = async (preview = false) => {
    const upload = selected;
    const source = preview
      ? original
        ? { kind: "preview" as const, image: original }
        : undefined
      : upload
        ? { kind: "upload" as const, reference: reference(upload) }
        : undefined;
    if (!snapshot || !source) return;
    await safely(async () => {
      if (
        !(await (preview
          ? checkImportAccess("vocabulary-analysis", Boolean(original))
          : requestAiAccess(
              "vocabulary-analysis",
              undefined,
              Boolean(upload?.image && !upload.hasText),
            )))
      )
        return;
      if (scopeRef.current === null) return;
      const captured = scopeRef.current;
      const result = await operation.run({
        kind: "vocabulary-analysis",
        rootGeneration: snapshot.rootGeneration,
        source,
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
      if (!upload) return;
      const proposals = await invokeDesktop("uploads/analyses", {
        rootGeneration: snapshot.rootGeneration,
        reference: reference(upload),
      });
      if (captured !== scopeRef.current) return;
      setAnalyses(proposals.analyses);
      setPositions(proposals.analyses[0]?.output.words.map((_, i) => i) ?? []);
      if (!upload.hasText && output.extractedText) {
        setEditing(selected);
        setDraft({
          format: upload.format,
          title: upload.title,
          text: output.extractedText,
          ...(upload.url ? { url: upload.url } : {}),
        });
        setEditor(true);
      }
    });
  };
  const proposal = analyses[0];
  return {
    library,
    error,
    editor,
    selected,
    snapshot,
    t,
    working,
    onAddContent,
    open,
    setRenaming,
    setSelected,
    renaming,
    safely,
    scopeRef,
    scope,
    saveSubmission,
    setAnalyses,
    setSavedWords,
    rememberDraft,
    setEditing,
    setWebsitePreview,
    websiteDraftCache,
    setDraft,
    draftCache,
    setOriginal,
    setEditor,
    analyse,
    onPractise,
    operation,
    message,
    proposal,
    positions,
    setPositions,
    savedWords,
    setWordId,
    editing,
    draft,
    setImageAccess,
    setError,
    setImportAccessError,
    setMessage,
    formatDrafts,
    formatWebsitePreview,
    websitePreview,
    setTruncated,
    checkImportAccess,
    readingId,
    setReadingWebsite,
    imageAccess,
    original,
    acceptImage,
    importAccessError,
    truncated,
    readingWebsite,
    cancelWebsite,
    wordId,
    onWordNavigate,
  };
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  translationRequestSchema,
  type TranslationRequest,
  type ProviderOperation,
  type SavedTranslation as SavedTranslationRecord,
  type Language,
  type CorrelationId,
} from "@call-nina/contracts";
import { Button, Feedback } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { LanguageSelect } from "./LanguageSelect.js";
import { createDesktopSubmissionId, invokeDesktop, subscribeDesktop } from "./ipc.js";
import styles from "./SavedTranslation.module.css";

export type TranslationAccess = (operation: ProviderOperation) => Promise<boolean>;
export type SavedTranslationContext = Omit<TranslationRequest, "field"> & {
  requestAiAccess: TranslationAccess;
};

export function SavedTranslation({
  request,
  requestAiAccess,
}: {
  request: TranslationRequest;
  requestAiAccess: TranslationAccess;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.controls}>
      <Button
        variant="quiet"
        aria-expanded={open}
        aria-controls={id}
        onPress={() => {
          setOpen(!open);
        }}
      >
        {t(open ? "translation.close" : "translation.action")}
      </Button>
      {open && (
        <div id={id}>
          <TranslationControls
            key={JSON.stringify(request)}
            request={request}
            requestAiAccess={requestAiAccess}
          />
        </div>
      )}
    </div>
  );
}

function TranslationControls({
  request: requestValue,
  requestAiAccess,
}: {
  request: TranslationRequest;
  requestAiAccess: TranslationAccess;
}) {
  const { t } = useTranslation();
  const requestKey = JSON.stringify(requestValue);
  const request = useMemo(
    () => translationRequestSchema.parse(JSON.parse(requestKey)),
    [requestKey],
  );
  const [language, setLanguage] = useState<Language>("en-US");
  const [translations, setTranslations] = useState<SavedTranslationRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [notice, setNotice] = useState<
    "failed" | "cancelled" | "unavailable" | "loadFailed" | "saved"
  >();
  const active = useRef<CorrelationId | undefined>(undefined);
  const alive = useRef(true);
  const locked = useRef(false);
  const load = useCallback(async () => {
    try {
      const result = await invokeDesktop("translation/read", request);
      if (alive.current) setTranslations(result.translations);
    } catch {
      if (alive.current) setNotice("loadFailed");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        alive.current = false;
        setTranslations([]);
        setAvailable(false);
        setNotice("loadFailed");
        setBusy(false);
      }
      if (
        event.event !== "translation-finished" ||
        event.operationId !== active.current ||
        event.rootGeneration !== request.rootGeneration
      )
        return;
      active.current = undefined;
      locked.current = false;
      if (!alive.current) return;
      setBusy(false);
      setNotice(event.outcome);
      if (event.outcome === "saved") void load();
    });
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      alive.current = false;
      unsubscribe();
      if (active.current)
        void invokeDesktop("translation/cancel", {
          rootGeneration: request.rootGeneration,
          operationId: active.current,
        }).catch(() => undefined);
    };
  }, [request, load]);
  const isAlive = () => alive.current;
  const saved = translations.find((item) => item.language === language);
  const start = async () => {
    if (locked.current || saved || !isAlive()) return;
    locked.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      if (!(await requestAiAccess("contextual-help"))) {
        if (isAlive()) setNotice("unavailable");
        return;
      }
      if (!isAlive()) return;
      const operationId = createDesktopSubmissionId();
      active.current = operationId;
      const result = await invokeDesktop("translation/start", {
        ...request,
        operationId,
        language,
      });
      if (result.status === "saved") {
        active.current = undefined;
        if (isAlive()) {
          setNotice("saved");
          await load();
        }
      }
    } catch {
      active.current = undefined;
      if (isAlive()) setNotice("failed");
    } finally {
      if (!active.current) {
        locked.current = false;
        if (isAlive()) setBusy(false);
      }
    }
  };
  return (
    <div className={styles.controls}>
      <p>{t("translation.description")}</p>
      <LanguageSelect
        label={t("translation.language")}
        value={language}
        onChange={setLanguage}
        disabled={busy}
      />
      {saved && (
        <section className={styles.saved} aria-label={t("translation.derived")}>
          <strong>{t("translation.label", { language: t(`languages.${saved.language}`) })}</strong>
          <small>{t("translation.revision", { revision: saved.content.revisionId })}</small>
          <p lang={saved.language}>{saved.text}</p>
        </section>
      )}
      <ActionGroup>
        {!saved && (
          <Button isDisabled={loading || busy || !available} onPress={() => void start()}>
            {t(busy ? "translation.translating" : "translation.action")}
          </Button>
        )}
        {busy && (
          <Button
            variant="secondary"
            onPress={() => {
              if (active.current)
                void invokeDesktop("translation/cancel", {
                  rootGeneration: request.rootGeneration,
                  operationId: active.current,
                }).catch(() => {
                  if (isAlive()) setNotice("failed");
                });
            }}
          >
            {t("actions.cancel")}
          </Button>
        )}
        {notice === "loadFailed" && (
          <Button onPress={() => void load()}>{t("translation.retryRead")}</Button>
        )}
      </ActionGroup>
      {notice && (
        <Feedback
          live="polite"
          tone={notice === "failed" || notice === "loadFailed" ? "warning" : "info"}
        >
          {t(`translation.${notice}`)}
        </Feedback>
      )}
    </div>
  );
}

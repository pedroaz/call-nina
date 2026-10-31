import { type PracticeSource, type ActivityId, type ProviderOperation } from "@call-nina/contracts";
import { BookPlus } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup, Page } from "../../components/layout/index.js";
import { Button, Tabs } from "../../components/ui/index.js";
import type { SavedResultsScope } from "../../learning/results/savedResultsTypes.js";
import { UploadLibraryComponent } from "../../learning/uploads/uploads-library-context.js";
import { useVocabularyLearning } from "../../learning/vocabulary/useVocabularyLearning.js";
import styles from "./VocabularyLearning.module.css";

export function VocabularyLearningNotice() {
  const { t } = useTranslation();
  const { snapshot } = useVocabularyLearning();
  const count = snapshot?.unreadCount ?? 0;
  if (!count) return null;
  return (
    <span
      className={styles.notice}
      role="status"
      aria-label={t("vocabulary.updates.changed", { count })}
    />
  );
}
export function VocabularyLearning({
  onOpenActivity,
  requestAiAccess,
  onBusyChange,
  dueCount,
  uploadCount,
  onReview,
  reviewButtonRef,
  libraryBusy,
  children,
  viewRequest,
  onPractise,
  onWordNavigate,
}: {
  onOpenActivity: (activityId: ActivityId) => void;
  requestAiAccess: (
    operation: ProviderOperation,
    previousOperationId?: undefined,
    hasImage?: boolean,
  ) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  dueCount: number | undefined;
  uploadCount: number | undefined;
  onReview: () => void;
  reviewButtonRef: Ref<HTMLButtonElement>;
  libraryBusy: boolean;
  children: ReactNode;
  viewRequest: number;
  onWordNavigate: (page: "results" | "practice", scope?: SavedResultsScope) => void;
  onPractise: (source: PracticeSource) => void;
}) {
  const renderUploadLibrary = useContext(UploadLibraryComponent);
  if (!renderUploadLibrary) throw new Error("OD_UPLOAD_LIBRARY_MISSING");
  const { t } = useTranslation();
  const [tab, setTab] = useState("words"),
    [add, setAdd] = useState(0);
  const [contentBusy, setContentBusy] = useState(false);
  const reportBusy = useCallback(
    (busy: boolean) => {
      setContentBusy(busy);
      onBusyChange(busy);
    },
    [onBusyChange],
  );
  const previous = useRef(viewRequest);
  useEffect(() => {
    if (previous.current !== viewRequest) {
      previous.current = viewRequest;
      setTab("words");
    }
  }, [viewRequest]);
  return (
    <Page
      title={t("vocabulary.title")}
      actions={
        tab === "uploads" && uploadCount === 0 ? undefined : (
          <Button
            variant="primary"
            isDisabled={contentBusy}
            leadingIcon={<BookPlus aria-hidden="true" />}
            onPress={() => {
              setTab("uploads");
              setAdd((n) => n + 1);
            }}
          >
            {t("uploads.add")}
          </Button>
        )
      }
    >
      <Tabs
        label={t("vocabulary.title")}
        selectedKey={tab}
        onSelectionChange={(key) => {
          setTab(key);
        }}
        items={[
          {
            id: "words",
            label: t("vocabulary.title"),
            children: (
              <>
                {Boolean(dueCount) && (
                  <ActionGroup>
                    <Button
                      ref={reviewButtonRef}
                      variant="primary"
                      isDisabled={libraryBusy || !dueCount}
                      onPress={onReview}
                    >
                      {t("uploads.reviewDue", { count: dueCount ?? 0 })}
                    </Button>
                  </ActionGroup>
                )}
                {tab === "words" && children}
              </>
            ),
          },
          {
            id: "uploads",
            label: t("uploads.tab"),
            children: renderUploadLibrary({
              onAddContent: () => {
                setAdd((n) => n + 1);
              },
              onOpenActivity,
              onWordNavigate,
              requestAiAccess,
              onBusyChange: reportBusy,
              onPractise,
              openAdd: add,
            }),
          },
        ]}
      />
    </Page>
  );
}

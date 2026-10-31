import { type CallNinaError } from "@call-nina/contracts";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Readiness, type WorkspacePage } from "./app/App.types.js";
import {
  FolderOnboarding,
  OperationError,
  StartupError,
  StartupFrame,
  ViewBoundary,
} from "./app/Startup.js";
import styles from "./app/Startup.module.css";
import { Button, Card } from "./components/ui/index.js";
import { ProfileOnboarding } from "./features/onboarding/index.js";
import { type PathDestination } from "./learning/curriculum/learningPathNavigation.js";
import i18n from "./runtime/i18n.js";
import { invokeDesktop, normalizeDesktopError } from "./runtime/ipc.js";

import { DesktopWorkspace } from "./app/DesktopWorkspace.js";

export default function App() {
  const { t } = useTranslation();
  const [readiness, setReadiness] = useState<Readiness>();
  const [fatal, setFatal] = useState<CallNinaError>();
  const [recoveringRoot, setRecoveringRoot] = useState(false);
  const [profileOnboarding, setProfileOnboarding] = useState(false);
  const [repeatSetup, setRepeatSetup] = useState(false);
  const [initialPage, setInitialPage] = useState<WorkspacePage>("nina");
  const [initialPath, setInitialPath] = useState<PathDestination>();
  const load = useCallback(async () => {
    setFatal(undefined);
    try {
      const nextReadiness = await invokeDesktop("app/readiness", {});
      if (nextReadiness.dataRoot.status === "ready") {
        const profile = await invokeDesktop("learner-profile/read", {});
        if (profile.status === "ready") await i18n.changeLanguage(profile.profile.uiLocale);
        setProfileOnboarding(
          profile.status === "not-created" || profile.profile.onboardingState !== "complete",
        );
      }
      setReadiness(nextReadiness);
      setRecoveringRoot(false);
    } catch (cause) {
      setFatal(normalizeDesktopError(cause).detail);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    window.callNina.ready();
    return () => {
      window.clearTimeout(initialLoad);
    };
  }, [load]);
  if (fatal) {
    return (
      <StartupFrame>
        <Card as="section" className={styles.startupCard} role="alert">
          <h1>{t("startup.unavailableTitle")}</h1>
          <p>{t("startup.unavailableBody")}</p>
          <OperationError error={fatal} />
          <Button variant="primary" onPress={() => void load()}>
            {t("actions.retry")}
          </Button>
        </Card>
      </StartupFrame>
    );
  }
  if (!readiness) {
    return (
      <StartupFrame>
        <Card as="section" className={styles.startupCard} role="status">
          <LoaderCircle aria-hidden="true" /> {t("startup.loading")}
        </Card>
      </StartupFrame>
    );
  }
  if (readiness.dataRoot.status === "unconfigured" || recoveringRoot)
    return (
      <FolderOnboarding
        onReady={async () => {
          await load();
        }}
      />
    );
  if (readiness.dataRoot.status === "unavailable")
    return (
      <StartupError
        readiness={readiness}
        retry={load}
        recover={() => {
          setRecoveringRoot(true);
        }}
      />
    );
  if (profileOnboarding || repeatSetup)
    return (
      <ProfileOnboarding
        key={readiness.dataRoot.generation}
        readiness={readiness}
        {...(repeatSetup
          ? {
              onExit: () => {
                setRepeatSetup(false);
                setInitialPage("nina");
                setInitialPath(undefined);
                void load();
              },
            }
          : {})}
        onComplete={(destination) => {
          setProfileOnboarding(false);
          setInitialPage(destination ? "learningPath" : "nina");
          setInitialPath(destination);
          setRepeatSetup(false);
          void load();
        }}
      />
    );
  return (
    <ViewBoundary
      title={t("errors.boundaryTitle")}
      body={t("errors.boundaryBody")}
      close={t("actions.close")}
    >
      <DesktopWorkspace
        key={readiness.dataRoot.generation}
        readiness={readiness}
        reload={load}
        initialPage={initialPage}
        initialPath={initialPath}
        onRunSetup={() => {
          setRepeatSetup(true);
        }}
      />
    </ViewBoundary>
  );
}

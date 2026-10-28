import "./i18n";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, BackHandler } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ClerkProvider, useClerk, useSession, useSignIn, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import { BookOpen, RefreshCw, UserRound } from "lucide-react-native";
import { nativeDesignTokens as tokens } from "@call-nina/design-system";
import {
  languageIds,
  languageDefinitions,
  ninaPublicConfiguration,
  mobileSnapshotSchema,
  type MobileDeck,
  type MobileSnapshot,
  type Language,
} from "@call-nina/contracts";
import {
  downloadSnapshot,
  readPublished,
  SyncError,
  type SyncConnection,
} from "@call-nina/mobile-sync";
import { FontLicenses } from "./FontLicenses";
import { NativeFonts } from "./ui/NativeFonts";
import {
  NativeButton,
  NativeCard,
  NativeField,
  NativeRow,
  NativeScreen,
  NativeText,
  NinaMark,
} from "./ui/primitives";
import { FlashcardPlayer } from "./FlashcardPlayer";
import {
  clearVerifiedUser,
  readVerifiedUser,
  markVerifiedUser,
  clearLearning,
  installLibrary,
  readLibrary,
  readPreference,
  writePreference,
} from "./storage";

async function timed<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("timeout"));
        }, 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function hash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function Login() {
  const { t } = useTranslation();
  const { signIn } = useSignIn();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"loginError" | "incomplete">();
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await timed(signIn.password({ identifier: username.trim(), password }));
      if (result.error) throw new Error("credentials");
      if (signIn.status !== "complete") {
        setError("incomplete");
        return;
      }
      const finished = await timed(signIn.finalize());
      if (finished.error) throw new Error("incomplete");
      setPassword("");
    } catch {
      setError("loginError");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <NativeScreen centered>
      <NinaMark />
      <NativeText variant="title">Call Nina</NativeText>
      <NativeText variant="heading">{t("mobile.signIn")}</NativeText>
      <NativeField
        label={t("mobile.username")}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        editable={!busy}
      />
      <NativeField
        label={t("mobile.password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        editable={!busy}
        onSubmitEditing={() => void submit()}
      />
      <NativeButton
        label={t(visible ? "mobile.hidePassword" : "mobile.showPassword")}
        variant="quiet"
        onPress={() => {
          setVisible((v) => !v);
        }}
      />
      {error && <NativeText accessibilityRole="alert">{t(`mobile.${error}`)}</NativeText>}
      <NativeButton
        label={t(busy ? "mobile.signingIn" : "mobile.signIn")}
        variant="primary"
        disabled={busy || !username.trim() || !password}
        onPress={() => void submit()}
      />
    </NativeScreen>
  );
}
function AccountGate() {
  const { isLoaded, user } = useUser();
  const { session } = useSession();
  const clerk = useClerk();
  const { t, i18n } = useTranslation();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const currentSession = useRef<string | undefined>(session?.id);
  useLayoutEffect(() => {
    currentSession.current = session?.id;
    return () => {
      currentSession.current = undefined;
    };
  }, [session?.id]);
  useEffect(() => {
    void readPreference("language")
      .then((lang) => {
        if (lang && languageIds.includes(lang as Language)) void i18n.changeLanguage(lang);
      })
      .catch(() => undefined);
  }, [i18n]);
  const logout = async () => {
    currentSession.current = undefined;
    setSigningOut(true);
    setError(false);
    try {
      await clearVerifiedUser();
      await clearLearning();
      await timed(clerk.signOut());
    } catch {
      setError(true);
    } finally {
      setSigningOut(false);
    }
  };
  if (signingOut)
    return (
      <NativeScreen>
        <NativeText>{t("mobile.loading")}</NativeText>
      </NativeScreen>
    );
  if (error)
    return (
      <NativeScreen>
        <NativeText accessibilityRole="alert">{t("mobile.signOutError")}</NativeText>
        <NativeButton label={t("mobile.signOut")} onPress={() => void logout()} />
      </NativeScreen>
    );
  if (!isLoaded)
    return (
      <NativeScreen>
        <NativeText>{t("mobile.loading")}</NativeText>
      </NativeScreen>
    );
  if (!user || !session) return <Login />;
  if (session.status !== "active")
    return (
      <NativeScreen>
        <NativeText>{t("mobile.pending")}</NativeText>
        <NativeButton label={t("mobile.signOut")} onPress={() => void logout()} />
      </NativeScreen>
    );
  const capturedSession = session.id;
  return (
    <Library
      key={`${user.id}:${session.id}`}
      userId={user.id}
      username={user.username ?? ""}
      getToken={() => timed(session.getToken({ skipCache: true }))}
      assertCurrent={() => {
        if (currentSession.current !== capturedSession) throw new SyncError("changed");
      }}
      logout={() => void logout()}
    />
  );
}
function Library({
  userId,
  username,
  getToken,
  assertCurrent,
  logout,
}: {
  userId: string;
  username: string;
  getToken: () => Promise<string | null>;
  assertCurrent: () => void;
  logout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [library, setLibrary] = useState<MobileSnapshot>();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [tab, setTab] = useState<"library" | "account">("library");
  const [language, setLanguage] = useState<Language | "all">("all");
  const [query, setQuery] = useState("");
  const [deck, setDeck] = useState<MobileDeck>();
  const [licenses, setLicenses] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const currentId = useRef<string | undefined>(undefined);
  const activeDeck = useRef<MobileDeck | undefined>(undefined);
  const staged = useRef<{ id: string; snapshot: MobileSnapshot } | undefined>(undefined);
  const latest = useRef({ getToken, assertCurrent });
  useLayoutEffect(() => {
    latest.current = { getToken, assertCurrent };
  }, [getToken, assertCurrent]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isMounted = () => mounted.current;
  const assert = useCallback(() => {
    if (!mounted.current) throw new SyncError("changed");
    latest.current.assertCurrent();
  }, []);
  const apply = useCallback(
    async (value: { id: string; snapshot: MobileSnapshot }) => {
      await installLibrary(userId, value.id, value.snapshot, assert);
      assert();
      currentId.current = value.id;
      setLibrary(value.snapshot);
    },
    [userId, assert],
  );
  const refresh = useCallback(async () => {
    if (locked.current) return;
    const origin = ninaPublicConfiguration.serviceOrigin;
    if (!origin) {
      setMessage("offline");
      return;
    }
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    const connection: SyncConnection = {
      origin,
      hash,
      assertCurrent: assert,
      token: async () => {
        const token = await latest.current.getToken();
        if (!token) throw new SyncError("sign-in");
        return token;
      },
    };
    try {
      const published = await readPublished(connection);
      assert();
      await markVerifiedUser(userId, assert);
      assert();
      setAllowed(true);
      if (!published) {
        const empty = {
          id: "empty",
          snapshot: mobileSnapshotSchema.parse({
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            decks: [],
          }),
        };
        if (activeDeck.current) staged.current = empty;
        else await apply(empty);
      } else if (published.manifest.id !== currentId.current) {
        let value: MobileSnapshot;
        try {
          value = await downloadSnapshot(connection, published);
        } catch (error) {
          if (!(error instanceof SyncError) || error.reason !== "changed") throw error;
          const next = await readPublished(connection);
          if (!next) throw error;
          value = await downloadSnapshot(connection, next);
          published.manifest = next.manifest;
        }
        assert();
        const downloaded = { id: published.manifest.id, snapshot: value };
        if (activeDeck.current) staged.current = downloaded;
        else await apply(downloaded);
      }
    } catch (error) {
      if (isMounted()) {
        if (error instanceof SyncError && error.reason === "sign-in") {
          setAllowed(false);
          activeDeck.current = undefined;
          setDeck(undefined);
          staged.current = undefined;
          await clearVerifiedUser().catch(() => undefined);
          if (isMounted()) {
            setAllowed(false);
            activeDeck.current = undefined;
            setDeck(undefined);
            setMessage("required");
          }
        } else
          setMessage(
            error instanceof SyncError && error.reason === "update-required"
              ? "update"
              : error instanceof SyncError && error.reason === "changed"
                ? "changed"
                : "offline",
          );
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [userId, assert, apply]);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const verified = await readVerifiedUser();
        assert();
        if (verified !== userId) {
          await clearLearning();
          assert();
        }
        const cached = verified === userId ? await readLibrary(userId) : null;
        assert();
        setAllowed(verified === userId);
        if (cached) {
          currentId.current = cached.id;
          setLibrary(cached.snapshot);
        }
        setReady(true);
        await refresh();
      } catch {
        if (isMounted()) {
          setReady(true);
          setMessage("storageError");
        }
      }
    })();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      mounted.current = false;
      listener.remove();
    };
  }, [userId, assert, refresh]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "account") {
        setTab("library");
        return true;
      }
      return false;
    });
    return () => {
      sub.remove();
    };
  }, [tab]);
  const closeDeck = () => {
    activeDeck.current = undefined;
    setDeck(undefined);
    const pending = staged.current;
    staged.current = undefined;
    if (pending)
      void apply(pending).catch(() => {
        setMessage("storageError");
      });
  };
  if (deck && allowed)
    return <FlashcardPlayer user={userId} deck={deck} onClose={closeDeck} assertCurrent={assert} />;
  const filtered = library?.decks.filter(
    (d) =>
      (language === "all" || d.content.language === language) &&
      d.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const icon = (Icon: typeof BookOpen) => (
    <Icon size={20} color={tokens.colors.textStrong} accessibilityElementsHidden />
  );
  return (
    <>
      <NativeScreen
        footer={
          <NativeRow>
            <NativeButton
              label={t("mobile.library")}
              selected={tab === "library"}
              icon={icon(BookOpen)}
              onPress={() => {
                setTab("library");
              }}
            />
            <NativeButton
              label={t("mobile.account")}
              selected={tab === "account"}
              icon={icon(UserRound)}
              onPress={() => {
                setTab("account");
              }}
            />
          </NativeRow>
        }
      >
        <NativeText variant="title">
          {t(tab === "account" ? "mobile.account" : "mobile.library")}
        </NativeText>
        {tab === "account" ? (
          <>
            <NativeText>{username}</NativeText>
            <NativeButton label={t("mobile.signOut")} onPress={logout} />
            <NativeText variant="heading">{t("mobile.language")}</NativeText>
            <NativeRow>
              {languageIds.map((lang) => (
                <NativeButton
                  key={lang}
                  label={languageDefinitions[lang].name}
                  selected={i18n.language === lang}
                  onPress={() => {
                    void i18n.changeLanguage(lang);
                    void writePreference("language", lang).catch(() => {
                      setMessage("storageError");
                    });
                  }}
                />
              ))}
            </NativeRow>
            <NativeButton
              label={t("mobile.licenses")}
              onPress={() => {
                setLicenses(true);
              }}
              variant="quiet"
            />
          </>
        ) : (
          <>
            <NativeButton
              label={t(busy ? "mobile.refreshing" : "mobile.refresh")}
              disabled={busy || !ready}
              icon={icon(RefreshCw)}
              onPress={() => void refresh()}
            />
            {!ready && <NativeText>{t("mobile.loading")}</NativeText>}
            {allowed && (
              <>
                <NativeText variant="subheading">{t("mobile.learningLanguage")}</NativeText>
                <NativeRow>
                  <NativeButton
                    label={t("mobile.all")}
                    selected={language === "all"}
                    onPress={() => {
                      setLanguage("all");
                    }}
                  />
                  {languageIds.map((lang) => (
                    <NativeButton
                      key={lang}
                      label={languageDefinitions[lang].name}
                      selected={language === lang}
                      onPress={() => {
                        setLanguage(lang);
                      }}
                    />
                  ))}
                </NativeRow>
                <NativeField label={t("mobile.search")} value={query} onChangeText={setQuery} />
                {!library?.decks.length ? (
                  <NativeText>{t("mobile.empty")}</NativeText>
                ) : !filtered?.length ? (
                  <NativeText>{t("mobile.noMatches")}</NativeText>
                ) : (
                  filtered.map((item) => (
                    <NativeCard key={item.activityId}>
                      <NativeText variant="heading">{item.title}</NativeText>
                      <NativeText tone="muted">
                        {languageDefinitions[item.content.language].name} ·{" "}
                        {item.content.cards.length}
                      </NativeText>
                      <NativeButton
                        label={item.title}
                        icon={icon(BookOpen)}
                        onPress={() => {
                          activeDeck.current = item;
                          setDeck(item);
                        }}
                      />
                    </NativeCard>
                  ))
                )}
              </>
            )}
            {!allowed && ready && !busy && (
              <NativeButton label={t("mobile.signOut")} onPress={logout} />
            )}
          </>
        )}
        {message && (
          <NativeText accessibilityLiveRegion="polite">{t(`mobile.${message}`)}</NativeText>
        )}
      </NativeScreen>
      <FontLicenses
        open={licenses}
        onClose={() => {
          setLicenses(false);
        }}
      />
    </>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <NativeFonts>
        <StatusBar style="dark" />
        {ninaPublicConfiguration.publishableKey && ninaPublicConfiguration.serviceOrigin ? (
          <ClerkProvider
            publishableKey={ninaPublicConfiguration.publishableKey}
            {...(tokenCache ? { tokenCache } : {})}
            __experimental_resourceCache={resourceCache}
            __experimental_disableNativeClientSync
            telemetry={false}
          >
            <AccountGate />
          </ClerkProvider>
        ) : (
          <NativeScreen>
            <NativeText>Call Nina</NativeText>
          </NativeScreen>
        )}
      </NativeFonts>
    </SafeAreaProvider>
  );
}

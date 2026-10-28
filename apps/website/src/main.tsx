import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionLink, Button, Tabs } from "@call-nina/browser-ui";
import ninaPhone from "@call-nina/design-system/brand/nina-phone.png";
import ninaWelcome from "@call-nina/design-system/brand/nina-welcome.png";
import ninaThinking from "@call-nina/design-system/brand/nina-thinking.png";
import ninaListening from "@call-nina/design-system/brand/nina-listening.png";
import ninaCelebration from "@call-nina/design-system/brand/nina-celebration.png";
import { Discovery } from "./Discovery";
import { LanguageSelector } from "./LanguageSelector";
import { copy, featureIds, languages, type FeatureId, type Locale } from "./locales";

import "@call-nina/design-system/tokens.css";
import "@call-nina/design-system/fonts.css";
import "./styles.css";

const repository = "https://github.com/pedroaz/call-nina";
const featureImages: Record<FeatureId, string> = {
  exercises: ninaThinking,
  paths: ninaWelcome,
  writing: ninaListening,
  vocabulary: ninaCelebration,
};

function localeFromUrl(): Locale {
  const requested = new URLSearchParams(window.location.search).get("lang");
  return languages.find(({ code }) => code === requested)?.code ?? "en";
}

function StatusRow({
  label,
  available,
  yes,
  notYet,
}: {
  label: string;
  available: boolean;
  yes: string;
  notYet: string;
}) {
  return (
    <li className="status-row">
      <span>{label}</span>
      <span className="status" data-available={available}>
        {available ? yes : notYet}
      </span>
    </li>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>(localeFromUrl);
  const [feature, setFeature] = useState("exercises");
  const t = copy[locale];

  useEffect(() => {
    function syncLocale() {
      setLocale(localeFromUrl());
    }
    window.addEventListener("popstate", syncLocale);
    return () => {
      window.removeEventListener("popstate", syncLocale);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", t.description);
  }, [locale, t]);

  function changeLanguage(next: Locale) {
    setLocale(next);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="site-header wrap">
        <a className="wordmark" href="#main">
          <img src={ninaPhone} alt="" width="40" height="40" />
          Call Nina
        </a>
        <LanguageSelector locale={locale} onChange={changeLanguage} />
      </header>
      <main id="main" tabIndex={-1}>
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">{t.headline}</h1>
            <p className="lead">
              {t.introduction}
              <br />
              {t.free}
            </p>
            <div className="hero-actions">
              <Discovery
                locale={locale}
                onLocaleChange={changeLanguage}
                onExplore={(next) => {
                  if (next) setFeature(next);
                  requestAnimationFrame(() => {
                    const target = next
                      ? document.querySelector<HTMLElement>(
                          '.features [role="tab"][aria-selected="true"]',
                        )
                      : document.getElementById("features-title");
                    target?.focus({ preventScroll: true });
                    target?.scrollIntoView({ block: "center" });
                  });
                }}
              />
              <Button isDisabled>{t.download}</Button>
              <ActionLink href={repository} variant="secondary">
                {t.github}
                <span aria-hidden="true">↗</span>
              </ActionLink>
            </div>
            <p className="platform-note">{t.mobile}</p>
          </div>
          <div className="hero-art">
            <img src={ninaWelcome} alt="" width="1280" height="1280" fetchPriority="high" />
          </div>
        </section>
        <section className="features wrap" aria-labelledby="features-title">
          <h2 id="features-title" tabIndex={-1}>
            {t.featuresTitle}
          </h2>
          <Tabs
            label={t.featuresTitle}
            selectedKey={feature}
            onSelectionChange={setFeature}
            items={featureIds.map((id, index) => ({
              id,
              label: t.features[id].label,
              children: (
                <div className="feature-content">
                  <div className="feature-art">
                    <img src={featureImages[id]} alt="" width="1280" height="1280" loading="lazy" />
                  </div>
                  <div className="feature-copy">
                    <span className="feature-number" aria-hidden="true">
                      0{index + 1} / 04
                    </span>
                    <h3>{t.features[id].label}</h3>
                    <p>{t.features[id].text}</p>
                  </div>
                </div>
              ),
            }))}
          />
        </section>
        <div className="availability wrap">
          <section aria-labelledby="connections-title">
            <h2 id="connections-title">{t.connections}</h2>
            <p className="connection-intro">{t.subscriptions}</p>
            <ul className="status-list">
              <StatusRow label="ChatGPT" available yes={t.yes} notYet={t.notYet} />
              {t.providers.map(({ label, status }) => (
                <StatusRow
                  key={label}
                  label={label}
                  available
                  yes={status ?? t.yes}
                  notYet={t.notYet}
                />
              ))}
            </ul>
          </section>
          <section aria-labelledby="languages-title">
            <h2 id="languages-title">{t.languagesTitle}</h2>
            <ul className="status-list">
              {t.learningLanguages.map((label) => (
                <StatusRow key={label} label={label} available yes={t.yes} notYet={t.notYet} />
              ))}
              <StatusRow label={t.moreLanguages} available={false} yes={t.yes} notYet={t.notYet} />
            </ul>
          </section>
        </div>
      </main>
      <footer className="site-footer wrap">
        <div className="footer-copy">
          <p>{t.local}</p>
          <p>{t.costs}</p>
        </div>
        <div className="footer-links">
          <a href="mailto:pedro.azvm@gmail.com">{t.contact}</a>
          <a href={repository}>{t.source}</a>
          <a href={`${repository}/blob/main/LICENSE`}>{t.license}</a>
        </div>
      </footer>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Website root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

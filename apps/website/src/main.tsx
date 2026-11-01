import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, I18nProvider } from "@call-nina/browser-ui";
import ninaPhone from "@call-nina/design-system/brand/nina-phone.png";
import ninaWelcome from "@call-nina/design-system/brand/nina-welcome.png";
import { featureDetails } from "./feature-details";
import { Downloads } from "./Downloads";
import { Discovery } from "./Discovery";
import { LanguageSelector } from "./LanguageSelector";
import { copy, featureIds, languages, type FeatureId, type Locale } from "./locales";
import "@call-nina/design-system/tokens.css";
import "@call-nina/design-system/fonts.css";
import "./styles.css";

const isAboutPage = /^\/about(?:\/|\/index\.html)?$/.test(window.location.pathname);
const repository = "https://github.com/pedroaz/call-nina";
function localeFromUrl(): Locale {
  const requested = new URLSearchParams(window.location.search).get("lang");
  return languages.find(({ code }) => code === requested)?.code ?? "en";
}
function App() {
  const [locale, setLocale] = useState<Locale>(localeFromUrl);
  const [feature, setFeature] = useState<FeatureId>("paths");
  const t = copy[locale];
  useEffect(() => {
    const syncLocale = () => {
      setLocale(localeFromUrl());
    };
    window.addEventListener("popstate", syncLocale);
    return () => {
      window.removeEventListener("popstate", syncLocale);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = isAboutPage ? `${t.about} — Call Nina` : t.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", isAboutPage ? t.aboutPlaceholder : t.description);
  }, [locale, t]);
  function changeLanguage(next: Locale) {
    setLocale(next);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", url);
  }
  return (
    <I18nProvider locale={locale}>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="site-header wrap">
        <a className="wordmark" href={`/?lang=${encodeURIComponent(locale)}`}>
          <img src={ninaPhone} alt="" width="40" height="40" />
          Call Nina
        </a>
        <nav className="header-actions" aria-label="Call Nina">
          <a
            className="about-link"
            href={`/about/?lang=${encodeURIComponent(locale)}`}
            aria-current={isAboutPage ? "page" : undefined}
          >
            {t.about}
          </a>
          <a className="github-link" href={repository} aria-label={t.github} title={t.github}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.63 0c2.15-1.46 3.09-1.15 3.09-1.15.62 1.55.23 2.7.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.03.76 2.08v3.11c0 .3.21.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
            </svg>
          </a>
          <LanguageSelector locale={locale} onChange={changeLanguage} />
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {isAboutPage ? (
          <section className="about wrap" aria-labelledby="about-title">
            <h1 id="about-title">{t.about}</h1>
            <p>{t.aboutPlaceholder}</p>
          </section>
        ) : (
          <>
            <section className="hero wrap" aria-labelledby="hero-title">
              <div className="hero-copy">
                <h1 id="hero-title">{t.headline}</h1>
                <p className="lead">{t.mission}</p>
                <div className="hero-actions">
                  <Downloads locale={locale} />
                  <Discovery
                    locale={locale}
                    onLocaleChange={changeLanguage}
                    onExplore={(next) => {
                      setFeature(next ?? "paths");
                      requestAnimationFrame(() => {
                        const target = document.getElementById(
                          next ? `feature-${next}` : "features",
                        );
                        target?.focus({ preventScroll: true });
                        target?.scrollIntoView({ block: "center" });
                      });
                    }}
                  />
                </div>
              </div>
              <div className="hero-art">
                <img src={ninaWelcome} alt="" width="1280" height="1280" fetchPriority="high" />
              </div>
            </section>
            <section
              className="features wrap"
              id="features"
              tabIndex={-1}
              aria-label={t.featuresTitle}
            >
              <div className="feature-strip" role="group" aria-label={t.featuresTitle}>
                {featureIds.map((id) => (
                  <Button
                    key={id}
                    id={`feature-${id}`}
                    variant="quiet"
                    aria-pressed={feature === id}
                    aria-controls={`detail-${id}`}
                    onPress={() => {
                      setFeature(id);
                    }}
                  >
                    {t.features[id].label}
                  </Button>
                ))}
              </div>
              <div className="feature-panels">
                {featureIds.map((id) => (
                  <section
                    className="feature-detail"
                    id={`detail-${id}`}
                    key={id}
                    aria-hidden={feature !== id}
                    inert={feature !== id}
                    aria-labelledby={`detail-title-${id}`}
                  >
                    <div className="feature-overview">
                      <h2 id={`detail-title-${id}`}>{featureDetails[locale][id].title}</h2>
                      <p>{featureDetails[locale][id].description}</p>
                    </div>
                    <ul className="feature-points">
                      {featureDetails[locale][id].points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </I18nProvider>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Website root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

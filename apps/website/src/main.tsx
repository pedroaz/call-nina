import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { copy, languages, type Locale } from "./locales";
import { Blog, resolveBlog } from "./blog/Blog";
import { landingSections, siteLinks } from "./extensions";

import "@call-nina/design-system/tokens.css";
import "./styles.css";

function localeFromUrl(): Locale {
  const requested = new URLSearchParams(window.location.search).get("lang");
  return languages.find(({ code }) => code === requested)?.code ?? "en";
}

function App() {
  const [locale, setLocale] = useState<Locale>(localeFromUrl);
  const t = copy[locale];
  const isBlog =
    window.location.pathname.startsWith("/blog/") || window.location.pathname === "/blog";
  const blogPage = isBlog ? resolveBlog(window.location.pathname) : undefined;
  const home = isBlog ? `/?lang=${locale}` : "";

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
    document.title = blogPage?.title ?? t.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", blogPage?.description ?? t.description);
  }, [locale, t, blogPage?.title, blogPage?.description]);

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
        <a className="wordmark" href={`${home}#main`}>
          <span className="brand-mark" aria-hidden="true">
            n.
          </span>
          Call Nina
        </a>
        <nav aria-label={t.navigation}>
          <a href={`${home}#practice`}>{t.nav.practice}</a>
          <a href={`${home}#future`}>{t.nav.future}</a>
          {landingSections.map((section) => (
            <a key={section.id} href={`${home}#${section.id}`}>
              {section.title[locale]}
            </a>
          ))}
          {siteLinks.map((link) => (
            <a
              key={link.href}
              href={link.href === "/blog/" ? `${link.href}?lang=${locale}` : link.href}
              aria-current={isBlog && link.href === "/blog/" ? "page" : undefined}
            >
              {link.label[locale]}
            </a>
          ))}
          <a href={`${home}#downloads`}>{t.nav.downloads}</a>
        </nav>
        <div className="language-switch" role="group" aria-label={t.language}>
          {languages.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={locale === code}
              onClick={() => {
                changeLanguage(code);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {blogPage ? (
          <Blog page={blogPage} locale={locale} />
        ) : (
          <>
            <section className="hero wrap" aria-labelledby="hero-title">
              <div className="hero-copy">
                <p className="eyebrow">{t.prelaunch}</p>
                <h1 id="hero-title">{t.headline}</h1>
                <p className="lead">{t.introduction}</p>
                <div className="hero-actions">
                  <a className="primary-link" href={`${home}#practice`}>
                    {t.explore}
                    <span aria-hidden="true">↗</span>
                  </a>
                  <span className="availability">
                    {t.nav.downloads} · {t.downloadStatus}
                  </span>
                </div>
              </div>
              <figure className="language-card">
                <div className="card-top">
                  <span>{t.previewLabel}</span>
                  <span aria-hidden="true">DE / 01</span>
                </div>
                <div className="coffee-art" aria-hidden="true">
                  <span className="steam">~ ~</span>
                  <span className="cup" />
                  <span className="saucer" />
                </div>
                <h2>{t.previewTitle}</h2>
                <p className="german-example" lang="de">
                  {t.previewText}
                </p>
                <p>{t.previewTranslation}</p>
                <figcaption>{t.previewNote}</figcaption>
              </figure>
            </section>
            <section className="section wrap" id="practice" aria-labelledby="practice-title">
              <div className="section-heading">
                <p className="eyebrow">{t.practiceLabel}</p>
                <h2 id="practice-title">{t.practiceTitle}</h2>
                <p>{t.practiceIntro}</p>
              </div>
              <ol className="steps">
                {t.steps.map((step, index) => (
                  <li key={index}>
                    <span className="step-number" aria-hidden="true">
                      0{index + 1}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </li>
                ))}
              </ol>
              <aside className="local-note" aria-labelledby="local-title">
                <h3 id="local-title">{t.localTitle}</h3>
                <div>
                  <p>{t.localText}</p>
                  <p>{t.aiText}</p>
                </div>
              </aside>
            </section>
            <section className="future-band" id="future" aria-labelledby="future-title">
              <div className="section wrap">
                <div className="section-heading">
                  <p className="eyebrow">{t.futureLabel}</p>
                  <h2 id="future-title">{t.futureTitle}</h2>
                  <p>{t.futureIntro}</p>
                </div>
                <div className="future-grid">
                  {t.futureItems.map((item, index) => (
                    <article key={index}>
                      <span className="future-symbol" aria-hidden="true">
                        {["↗", "↔", "+"][index]}
                      </span>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
            {landingSections.map(({ id, title, Content }) => (
              <section className="section wrap" id={id} aria-labelledby={`${id}-title`} key={id}>
                <h2 id={`${id}-title`}>{title[locale]}</h2>
                <Content locale={locale} />
              </section>
            ))}
            <section
              className="section wrap downloads"
              id="downloads"
              aria-labelledby="downloads-title"
            >
              <p className="eyebrow">
                {t.nav.downloads} · {t.downloadStatus}
              </p>
              <h2 id="downloads-title">{t.downloadsTitle}</h2>
              <p>{t.downloadsText}</p>
              <p className="platforms">{t.platforms}</p>
            </section>
          </>
        )}
      </main>
      <footer className="site-footer wrap">
        <div>
          <p className="footer-brand">Call Nina</p>
          <p>{t.footer}</p>
        </div>
        <div>
          <a href="https://github.com/pedroaz/call-nina">
            {t.source} <span aria-hidden="true">↗</span>
          </a>
          <p>{t.license}</p>
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

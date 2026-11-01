import rawNotice from "../../../docs/website-privacy.json?raw";
import type { Locale } from "./locales";
import { privacyCopy } from "./privacy-copy";

type Notice = {
  updated: string;
  locales: Record<
    Locale,
    { title: string; sections: { title: string; paragraphs: string[] }[]; sources: string }
  >;
  sources: { label: string; url: string }[];
};
// Authored legal content is bundled from docs; it is not user input or a remote response.
const notice = JSON.parse(rawNotice) as Notice;
export function PrivacyNotice({ locale }: { locale: Locale }) {
  const content = notice.locales[locale];
  return (
    <article className="privacy-notice wrap" aria-labelledby="privacy-title">
      <h1 id="privacy-title">{content.title}</h1>
      <p>
        {privacyCopy[locale].updated}:{" "}
        <time dateTime={notice.updated}>
          {new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
            new Date(notice.updated),
          )}
        </time>
      </p>
      {content.sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p>
        <a href="mailto:pedro.azvm@gmail.com">pedro.azvm@gmail.com</a>
      </p>
      <h2>{content.sources}</h2>
      <ul>
        {notice.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url}>{source.label}</a>
          </li>
        ))}
      </ul>
    </article>
  );
}

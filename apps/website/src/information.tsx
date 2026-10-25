import type { Locale } from "./locales";
import { informationCopy } from "./information-copy";
import { ActionLink } from "@call-nina/browser-ui";
import "./information.css";

export function Faq({ locale }: { locale: Locale }) {
  return (
    <div className="faq-list">
      {informationCopy[locale].faq.map(({ question, answer }, index) => (
        <details key={index}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}

export function Contact({ locale }: { locale: Locale }) {
  const t = informationCopy[locale].contact;
  return (
    <div className="contact-content">
      <p className="lead">{t.introduction}</p>
      <ActionLink
        className="primary-link"
        href="mailto:pedro.azvm@gmail.com"
        aria-describedby="contact-hint"
      >
        {t.action}
      </ActionLink>
      <p>pedro.azvm@gmail.com</p>
      <p id="contact-hint">{t.hint}</p>
    </div>
  );
}

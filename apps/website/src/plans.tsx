import type { Locale } from "./locales";
import { planCopy } from "./plans-copy";
import "./plans.css";

export function Plans({ locale }: { locale: Locale }) {
  const t = planCopy[locale];
  return (
    <div className="plans-content">
      <p className="lead">{t.introduction}</p>
      <p className="plans-current">{t.current}</p>
      <p id="plans-scroll-hint" className="comparison-hint">
        {t.scrollHint}
      </p>
      <div
        className="comparison-scroll"
        role="region"
        aria-labelledby="comparison-caption"
        aria-describedby="plans-scroll-hint"
        // Keyboard users need to focus this region to scroll the wide comparison.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <table className="comparison">
          <caption id="comparison-caption">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.feature}</th>
              {t.tiers.map((tier) => (
                <th scope="col" key={tier}>
                  {tier}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => (
                  <td key={index}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t.funding}</p>
      <p>{t.license}</p>
    </div>
  );
}

export function Faq({ locale }: { locale: Locale }) {
  return (
    <div className="faq-list">
      {planCopy[locale].faq.map(({ question, answer }, index) => (
        <details key={index}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}

export function Contact({ locale }: { locale: Locale }) {
  const t = planCopy[locale].contact;
  return (
    <div className="contact-content">
      <p className="lead">{t.introduction}</p>
      <a
        className="primary-link"
        href="mailto:pedro.azvm@gmail.com"
        aria-describedby="contact-hint"
      >
        {t.action}
      </a>
      <p>pedro.azvm@gmail.com</p>
      <p id="contact-hint">{t.hint}</p>
    </div>
  );
}

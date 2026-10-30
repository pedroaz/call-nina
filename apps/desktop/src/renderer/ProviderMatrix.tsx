/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The table region is keyboard-scrollable. */
import type { InputHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import tableStyles from "./components/layout/Table.module.css";
import styles from "./ProviderMatrix.module.css";

export function ProviderMatrix({
  label,
  children,
  withVoice = false,
}: {
  label: string;
  children: ReactNode;
  withVoice?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.scroll} role="region" aria-label={label} tabIndex={0}>
      <table
        className={`${tableStyles.table} ${styles.table}`}
        data-with-voice={withVoice || undefined}
      >
        <thead>
          <tr>
            <th scope="col">{t("providers.provider")}</th>
            <th scope="col">{t("providers.status")}</th>
            {withVoice && <th scope="col">{t("speech.voice")}</th>}
            <th scope="col" data-column="default">
              {t("providers.default")}
            </th>
            <th scope="col">
              <span className={styles.hidden}>{t("setupUx.configure")}</span>
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ProviderChoice(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={styles.choice} title={props.title}>
      <input {...props} type="radio" />
    </label>
  );
}

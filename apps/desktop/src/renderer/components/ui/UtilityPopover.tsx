import type { ReactNode } from "react";
import { Dialog, DialogTrigger, Heading, Popover } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Button } from "./Button.js";
import styles from "./InfoHint.module.css";

export function UtilityPopover({
  label,
  summary,
  children,
  triggerClassName,
  leadingIcon,
  trailingIcon,
}: {
  label: string;
  summary?: string;
  children: ReactNode;
  triggerClassName?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DialogTrigger>
      <Button
        variant="quiet"
        className={`${styles.utilityTrigger} ${triggerClassName ?? ""}`}
        leadingIcon={leadingIcon}
        trailingIcon={trailingIcon}
      >
        {label}
        {summary ? ` · ${summary}` : ""}
      </Button>
      <Popover className={styles.popover} placement="top start">
        <Dialog className={styles.dialog}>
          <Heading slot="title">{label}</Heading>
          <div className={styles.utilityContent}>{children}</div>
          <Button variant="quiet" slot="close">
            {t("actions.close")}
          </Button>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

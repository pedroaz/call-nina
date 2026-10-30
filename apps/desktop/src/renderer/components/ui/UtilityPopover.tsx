import type { ReactNode } from "react";
import { Dialog, DialogTrigger, Heading, Popover, type PopoverProps } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button, IconButton } from "./Button.js";
import styles from "./InfoHint.module.css";

export function UtilityPopover({
  label,
  summary,
  children,
  triggerClassName,
  leadingIcon,
  trailingIcon,
  triggerContent,
  placement = "top start",
  closePosition = "footer",
}: {
  label: string;
  summary?: string;
  children: ReactNode;
  triggerClassName?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  triggerContent?: ReactNode;
  placement?: NonNullable<PopoverProps["placement"]>;
  closePosition?: "footer" | "top-right";
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
        {triggerContent ?? `${label}${summary ? ` · ${summary}` : ""}`}
      </Button>
      <Popover className={styles.popover} placement={placement}>
        <Dialog className={styles.dialog} data-close-position={closePosition}>
          {closePosition === "top-right" ? (
            <div className={styles.utilityHeader}>
              <Heading slot="title">{label}</Heading>
              <IconButton
                variant="quiet"
                density="compact"
                slot="close"
                label={t("actions.close")}
                leadingIcon={<X aria-hidden="true" />}
              />
            </div>
          ) : (
            <Heading slot="title">{label}</Heading>
          )}
          <div className={styles.utilityContent}>{children}</div>
          {closePosition === "footer" && (
            <Button variant="quiet" slot="close">
              {t("actions.close")}
            </Button>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

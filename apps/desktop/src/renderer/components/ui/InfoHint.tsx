import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Dialog, DialogTrigger, Heading, Popover } from "react-aria-components";

import { Button } from "./Button.js";
import styles from "./InfoHint.module.css";

export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DialogTrigger>
      <Button
        aria-label={label}
        className={styles.trigger}
        variant="quiet"
        leadingIcon={<Info aria-hidden="true" />}
      >
        <span className={styles.hidden}>{label}</span>
      </Button>
      <Popover className={styles.popover} placement="bottom start">
        <Dialog className={styles.dialog}>
          <Heading slot="title">{label}</Heading>
          <div>{children}</div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

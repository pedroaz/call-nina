import { useState, type ReactNode } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import { Button, type ButtonVariant } from "./Button.js";
import { Feedback } from "./Feedback.js";
import styles from "./Dialog.module.css";

export function Dialog(props: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  isDismissable?: boolean;
  density?: "compact" | "comfortable";
}) {
  return (
    <DialogTrigger>
      {props.trigger}
      <ModalOverlay className={styles.overlay} isDismissable={props.isDismissable ?? true}>
        <Modal className={styles.dialog} data-density={props.density ?? "comfortable"}>
          <AriaDialog>
            <Heading slot="title">{props.title}</Heading>
            <div className={styles.body}>{props.children}</div>
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export function ModalDialog(props: {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  isDismissable?: boolean;
  density?: "compact" | "comfortable";
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isDismissable={props.isDismissable ?? true}
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
    >
      <Modal className={styles.dialog} data-density={props.density ?? "comfortable"}>
        <AriaDialog>
          <Heading slot="title">{props.title}</Heading>
          <div className={styles.body}>{props.children}</div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export function ConfirmDialog(props: {
  trigger: string;
  triggerNode?: ReactNode;
  triggerVariant?: ButtonVariant;
  density?: "compact" | "comfortable";
  title: string;
  body: ReactNode;
  errorMessage?: ReactNode;
  confirm: string;
  pendingLabel?: string;
  cancel: string;
  onConfirm?: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <DialogTrigger>
      {props.triggerNode ?? (
        <Button variant={props.triggerVariant ?? "danger"}>{props.trigger}</Button>
      )}
      <ModalOverlay className={styles.overlay} isDismissable={!pending}>
        <Modal className={styles.dialog} data-density={props.density ?? "comfortable"}>
          <AriaDialog>
            {({ close }) => (
              <>
                <Heading slot="title">{props.title}</Heading>
                <div className={styles.body}>
                  <div>{props.body}</div>
                  {failed && props.errorMessage && (
                    <Feedback tone="error" live="assertive">
                      {props.errorMessage}
                    </Feedback>
                  )}
                </div>
                <div className={styles.actions}>
                  <Button
                    isPending={pending}
                    pendingLabel={props.pendingLabel ?? props.confirm}
                    variant="danger"
                    onPress={() => {
                      setPending(true);
                      setFailed(false);
                      Promise.resolve(props.onConfirm?.())
                        .then(close)
                        .catch(() => {
                          setFailed(true);
                        })
                        .finally(() => {
                          setPending(false);
                        });
                    }}
                  >
                    {props.confirm}
                  </Button>
                  <Button variant="secondary" isDisabled={pending} onPress={close}>
                    {props.cancel}
                  </Button>
                </div>
              </>
            )}
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export { AriaDialog as PopoverDialog, DialogTrigger as PopoverDialogTrigger };

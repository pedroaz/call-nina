import {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  type ReactNode,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import { Button, type ButtonVariant } from "./Button.js";
import { OverflowMenu } from "./OverflowMenu.js";
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
  keepMounted?: boolean;
  size?: "default" | "large";
  closeLabel?: string;
  title: string;
  children: ReactNode;
  isDismissable?: boolean;
  density?: "compact" | "comfortable";
  onOpenChange: (open: boolean) => void;
}) {
  const [activated, setActivated] = useState(props.isOpen);
  const [container] = useState(() => document.createElement("div"));
  const parking = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      host.current = node;
      if (node) node.appendChild(container);
    },
    [container],
  );
  useLayoutEffect(() => {
    if (props.isOpen) setActivated(true);
    if (props.keepMounted) {
      const destination = props.isOpen ? host.current : parking.current;
      destination?.appendChild(container);
    }
  }, [props.isOpen, props.keepMounted, container]);
  return (
    <>
      {props.keepMounted && <div hidden ref={parking} />}
      {props.keepMounted && (activated || props.isOpen) && createPortal(props.children, container)}
      <ModalOverlay
        className={styles.overlay}
        isDismissable={props.isDismissable ?? true}
        isOpen={props.isOpen}
        onOpenChange={props.onOpenChange}
      >
        <Modal
          className={styles.dialog}
          data-density={props.density ?? "comfortable"}
          data-size={props.size ?? "default"}
        >
          <AriaDialog>
            {props.closeLabel ? (
              <div className={styles.header}>
                <Heading slot="title">{props.title}</Heading>
                <Button variant="quiet" onPress={() => props.onOpenChange(false)}>
                  {props.closeLabel}
                </Button>
              </div>
            ) : (
              <Heading slot="title">{props.title}</Heading>
            )}
            <div className={styles.body} ref={props.keepMounted ? attach : undefined}>
              {props.keepMounted ? null : props.children}
            </div>
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}

export function ConfirmDialog(props: {
  trigger: string;
  menuLabel?: string;
  menuItems?: ComponentProps<typeof OverflowMenu>["items"];
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
  const [open, setOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && props.menuLabel) menuTrigger.current?.focus();
      }}
    >
      {props.menuLabel ? (
        <OverflowMenu
          triggerRef={menuTrigger}
          label={props.menuLabel}
          disabled={pending}
          items={[
            ...(props.menuItems ?? []),
            {
              id: "delete",
              label: props.trigger,
              destructive: true,
              onAction: () => setOpen(true),
            },
          ]}
        />
      ) : (
        (props.triggerNode ?? (
          <Button variant={props.triggerVariant ?? "danger"}>{props.trigger}</Button>
        ))
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
                  <Button variant="secondary" isDisabled={pending} onPress={close}>
                    {props.cancel}
                  </Button>
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

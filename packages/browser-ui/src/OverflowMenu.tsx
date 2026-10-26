import type { Ref } from "react";
import { MenuTrigger, Menu, MenuItem, Popover } from "react-aria-components";
import { Ellipsis } from "lucide-react";
import { Button } from "./Button.js";
import styles from "./OverflowMenu.module.css";

export function OverflowMenu({
  label,
  items,
  disabled = false,
  triggerRef,
}: {
  label: string;
  triggerRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  items: ReadonlyArray<{
    id: string;
    label: string;
    onAction: () => void;
    destructive?: boolean;
    isDisabled?: boolean;
  }>;
}) {
  return (
    <MenuTrigger>
      <Button
        {...(triggerRef ? { ref: triggerRef } : {})}
        variant="quiet"
        aria-label={label}
        isDisabled={disabled}
      >
        <Ellipsis aria-hidden="true" />
      </Button>
      <Popover className={styles.popover} placement="bottom end">
        <Menu aria-label={label} className={styles.menu}>
          {items.map((item) => (
            <MenuItem
              key={item.id}
              id={item.id}
              textValue={item.label}
              isDisabled={item.isDisabled ?? false}
              onAction={item.onAction}
              className={styles.item}
              data-destructive={item.destructive || undefined}
            >
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

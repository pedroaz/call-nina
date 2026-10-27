import { useContext, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Tabs } from "../ui/index.js";
import { ActivityLayoutContext } from "./ActivityWorkspace.js";
import styles from "./Activity.module.css";
export type ActivityReferenceItem = { id: string; label: string; content: ReactNode };
export function ActivityReference({
  label,
  items,
}: {
  label: string;
  items: readonly ActivityReferenceItem[];
}) {
  const bounded = useContext(ActivityLayoutContext);
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  return (
    <details
      className={styles.referenceDisclosure}
      aria-label={label}
      tabIndex={bounded ? 0 : undefined}
      open={bounded || open}
      onToggle={(event) => {
        if (!bounded) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <ChevronRight aria-hidden="true" />
        {label}
      </summary>
      <div className={styles.referenceContent}>
        {items.length === 1 ? (
          items[0]?.content
        ) : (
          <Tabs
            label={label}
            density="compact"
            items={items.map((item) => ({
              id: item.id,
              label: item.label,
              children: item.content,
            }))}
          />
        )}
      </div>
    </details>
  );
}

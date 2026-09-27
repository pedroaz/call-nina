import type { ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from "react-aria-components";
import styles from "./Tabs.module.css";

export function Tabs({
  label,
  items,
  selectedKey,
  onSelectionChange,
}: {
  label: string;
  selectedKey?: string;
  onSelectionChange?: (key: string) => void;
  items: ReadonlyArray<{ id: string; label: string; children: ReactNode }>;
}) {
  return (
    <AriaTabs
      className={styles.tabs}
      {...(selectedKey !== undefined ? { selectedKey } : {})}
      {...(onSelectionChange
        ? {
            onSelectionChange: (key) => {
              onSelectionChange(String(key));
            },
          }
        : {})}
    >
      <TabList aria-label={label} className={styles.list}>
        {items.map((item) => (
          <Tab key={item.id} id={item.id} className={styles.tab}>
            {item.label}
          </Tab>
        ))}
      </TabList>
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id} className={styles.panel} shouldForceMount>
          {item.children}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}

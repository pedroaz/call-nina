import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { IconButton, Tooltip } from "../ui/Button.js";
import styles from "./AppShell.module.css";

export type ShellNavigationItem<Page extends string> = Readonly<{
  page: Page;
  label: string;
  icon: LucideIcon;
}>;

export function AppShell<Page extends string>(props: {
  activePage: Page;
  navigation: ReadonlyArray<ShellNavigationItem<Page>>;
  navigationLabel: string;
  brandName: string;
  brandMark: string;
  navCollapsed: boolean;
  navToggleLabel: string;
  helperOpen: boolean;
  helperTitle: string;
  helperToggleLabel: string;
  exerciseMode?: boolean;
  wide?: boolean;
  content: ReactNode;
  helper: ReactNode;
  navFooter?: ReactNode;
  onNavigate: (page: Page) => void;
  onMoveNavFocus: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onToggleNavigation: () => void;
  onToggleHelper: () => void;
}) {
  const focusHelperOnOpen = useRef(false);
  const focusHelperOnClose = useRef(false);
  const helperToggle = useRef<HTMLButtonElement>(null);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const helper = useRef<HTMLElement>(null);
  const { onToggleNavigation, onToggleHelper, navCollapsed, helperOpen } = props;
  useEffect(() => {
    if (helperOpen && focusHelperOnOpen.current) {
      helper.current?.focus();
      focusHelperOnOpen.current = false;
    } else if (!helperOpen && focusHelperOnClose.current) {
      helperToggle.current?.focus();
      focusHelperOnClose.current = false;
    }
  }, [helperOpen]);
  const macKeyboard = /Mac/u.test(navigator.platform);
  const shortcutModifier = macKeyboard ? "⌘" : "Ctrl+";
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        event.key === "Escape" &&
        helperOpen &&
        helper.current?.contains(document.activeElement) &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        focusHelperOnClose.current = true;
        onToggleHelper();
        return;
      }

      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !(macKeyboard ? event.metaKey : event.ctrlKey) ||
        event.altKey ||
        (macKeyboard ? event.ctrlKey : event.metaKey) ||
        event.shiftKey ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        if (!navCollapsed && navigation.current?.contains(document.activeElement)) {
          navigationToggle.current?.focus();
        }
        onToggleNavigation();
      } else if (key === "g") {
        event.preventDefault();
        if (helperOpen && helper.current?.contains(document.activeElement)) {
          focusHelperOnClose.current = true;
        }
        focusHelperOnOpen.current = !helperOpen;
        onToggleHelper();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [onToggleNavigation, onToggleHelper, navCollapsed, helperOpen, macKeyboard]);
  return (
    <div
      className={`${styles.shell} ${props.navCollapsed ? styles.navCollapsed : ""} ${props.helperOpen ? "" : styles.helperCollapsed} ${props.wide ? styles.wide : ""}`}
      data-exercise-mode={props.exerciseMode || undefined}
      data-nav-collapsed={props.navCollapsed || undefined}
    >
      <nav ref={navigation} className={styles.nav} aria-label={props.navigationLabel}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <img alt="" className={styles.brandMark} src={props.brandMark} />
            <span className={styles.brandText}>{props.brandName}</span>
            <IconButton
              ref={navigationToggle}
              label={`${props.navToggleLabel} (${shortcutModifier}B)`}
              aria-keyshortcuts={macKeyboard ? "Meta+B" : "Control+B"}
              aria-expanded={!props.navCollapsed}
              leadingIcon={
                props.navCollapsed ? (
                  <PanelLeftOpen aria-hidden="true" />
                ) : (
                  <PanelLeftClose aria-hidden="true" />
                )
              }
              onPress={props.onToggleNavigation}
            />
          </div>
          <ul className={styles.navList}>
            {props.navigation.map(({ page, label, icon: Icon }) => {
              const control = (
                <button
                  aria-label={label}
                  aria-current={props.activePage === page ? "page" : undefined}
                  className={styles.navButton}
                  data-nav
                  onClick={() => {
                    props.onNavigate(page);
                  }}
                  onKeyDown={props.onMoveNavFocus}
                  type="button"
                >
                  <Icon aria-hidden="true" />
                  <span className={styles.navLabel}>{label}</span>
                </button>
              );
              return (
                <li key={page}>
                  {props.navCollapsed ? <Tooltip label={label}>{control}</Tooltip> : control}
                </li>
              );
            })}
          </ul>
          {props.navFooter && <div className={styles.navFooter}>{props.navFooter}</div>}
        </div>
      </nav>
      <main className={styles.workspace} id="main-content">
        <div className={styles.workspaceInner}>
          <header className={styles.workspaceHeader}>
            <span className={styles.location}>
              {props.navigation.find((item) => item.page === props.activePage)?.label}
            </span>
            {!helperOpen && (
              <IconButton
                variant="quiet"
                className={styles.helperToggle}
                ref={helperToggle}
                label={`${props.helperToggleLabel} (${shortcutModifier}G)`}
                aria-keyshortcuts={macKeyboard ? "Meta+G" : "Control+G"}
                aria-expanded={false}
                aria-controls="context-helper"
                leadingIcon={<PanelRightOpen aria-hidden="true" />}
                onPress={() => {
                  focusHelperOnOpen.current = true;
                  props.onToggleHelper();
                }}
              />
            )}
          </header>
          {props.content}
        </div>
      </main>
      <aside
        ref={helper}
        id="context-helper"
        tabIndex={-1}
        className={styles.helper}
        hidden={!props.helperOpen}
        aria-label={props.helperTitle}
      >
        <div className={styles.helperInner}>
          <div className={styles.helperHeader}>
            <h2>{props.helperTitle}</h2>
            <IconButton
              variant="quiet"
              className={styles.helperToggle}
              aria-expanded={true}
              aria-controls="context-helper"
              label={`${props.helperToggleLabel} (${shortcutModifier}G)`}
              aria-keyshortcuts={macKeyboard ? "Meta+G" : "Control+G"}
              leadingIcon={<PanelRightClose aria-hidden="true" />}
              onPress={() => {
                focusHelperOnClose.current = true;
                props.onToggleHelper();
              }}
            />
          </div>
          <div className={styles.helperContent}>{props.helper}</div>
        </div>
      </aside>
    </div>
  );
}

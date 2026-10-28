import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button.js";

/** Local presentation navigation: never remounts the owning activity controller. */
export function useDetailNavigation<T extends string = string>() {
  const [view, setView] = useState<T>();
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const scroll = useRef<Array<{ element: HTMLElement; top: number; left: number }>>([]);
  const returning = useRef(false);
  const open = (next: T) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    scroll.current = [];
    for (let node = origin.current?.parentElement; node; node = node.parentElement) {
      scroll.current.push({ element: node, top: node.scrollTop, left: node.scrollLeft });
    }
    setView(next);
  };
  const back = () => {
    returning.current = true;
    setView(undefined);
  };
  useLayoutEffect(() => {
    if (view) {
      for (const { element } of scroll.current)
        element.scrollTo({ top: 0, left: 0, behavior: "instant" });
      heading.current?.parentElement?.scrollIntoView({ block: "start", behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    } else if (returning.current) {
      returning.current = false;
      if (origin.current?.isConnected) origin.current.focus({ preventScroll: true });
      else {
        const container = scroll.current.find(({ element }) => element.isConnected)?.element;
        container
          ?.querySelector<HTMLElement>('button, [href], [tabindex="0"]')
          ?.focus({ preventScroll: true });
      }
      for (const { element, top, left } of scroll.current)
        element.scrollTo({ top, left, behavior: "instant" });
    }
  }, [view]);
  return { view, open, back, heading };
}

export function DetailHeader({
  title,
  onBack,
  heading,
}: {
  title: string;
  onBack: () => void;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <header>
      <Button variant="quiet" onPress={onBack} leadingIcon={<ArrowLeft aria-hidden="true" />}>
        {t("ui.back")}
      </Button>
      <h2 ref={heading} tabIndex={-1} data-focus-anchor>
        {title}
      </h2>
    </header>
  );
}

import { createContext } from "react";

export const VocabularyNavigation = createContext<{
  activityId: string | undefined;
  view: (activityId: string | undefined) => void;
}>({ activityId: undefined, view: () => {} });

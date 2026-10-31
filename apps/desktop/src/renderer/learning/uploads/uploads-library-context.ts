import { createContext, type ReactNode } from "react";
import type { UploadsLibraryProps } from "./UploadsLibrary.types.js";

export const UploadLibraryComponent = createContext<
  ((props: UploadsLibraryProps) => ReactNode) | null
>(null);

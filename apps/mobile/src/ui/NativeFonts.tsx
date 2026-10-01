import { nativeDesignTokens } from "@call-nina/design-system";
import figtreeRegular from "@call-nina/design-system/fonts/Figtree-400.ttf";
import figtreeBold from "@call-nina/design-system/fonts/Figtree-700.ttf";
import fredokaBold from "@call-nina/design-system/fonts/Fredoka-700.ttf";
import jetBrainsMonoRegular from "@call-nina/design-system/fonts/JetBrainsMono-400.ttf";
import notoSansMonoRegular from "@call-nina/design-system/fonts/NotoSansMono-400.ttf";
import { useFonts } from "expo-font";
import { createContext, useContext, type PropsWithChildren } from "react";

const LocalFontsContext = createContext(false);

export function NativeFonts({ children }: PropsWithChildren) {
  const [loaded, error] = useFonts({
    [nativeDesignTokens.typography.families.displayBold]: fredokaBold,
    [nativeDesignTokens.typography.families.bodyRegular]: figtreeRegular,
    [nativeDesignTokens.typography.families.bodyBold]: figtreeBold,
    [nativeDesignTokens.typography.families.phoneticRegular]: jetBrainsMonoRegular,
    [nativeDesignTokens.typography.families.phoneticIpaRegular]: notoSansMonoRegular,
  });

  // Render immediately with system faces, including when a bundled font fails.
  return <LocalFontsContext value={loaded && !error}>{children}</LocalFontsContext>;
}

export function useLocalFonts() {
  return useContext(LocalFontsContext);
}

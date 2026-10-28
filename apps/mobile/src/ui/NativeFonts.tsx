import SourceSans3400 from "@call-nina/design-system/fonts/SourceSans3-400.ttf";
import SourceSans3600 from "@call-nina/design-system/fonts/SourceSans3-600.ttf";
import SourceSans3700 from "@call-nina/design-system/fonts/SourceSans3-700.ttf";
import SourceSerif4400 from "@call-nina/design-system/fonts/SourceSerif4-400.ttf";
import SourceSerif4600 from "@call-nina/design-system/fonts/SourceSerif4-600.ttf";
import SourceSerif4700 from "@call-nina/design-system/fonts/SourceSerif4-700.ttf";

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
    [nativeDesignTokens.typography.families.interface400]: SourceSans3400,
    [nativeDesignTokens.typography.families.interface600]: SourceSans3600,
    [nativeDesignTokens.typography.families.interface700]: SourceSans3700,
    [nativeDesignTokens.typography.families.editorial400]: SourceSerif4400,
    [nativeDesignTokens.typography.families.editorial600]: SourceSerif4600,
    [nativeDesignTokens.typography.families.editorial700]: SourceSerif4700,
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

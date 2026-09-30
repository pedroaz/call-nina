const colorPalette = {
  wheat: {
    50: "#fff6ea",
    100: "#fde8cc",
    200: "#f9d0a0",
    300: "#f3b26e",
    400: "#ea9548",
    500: "#db7a2c",
    600: "#ba601d",
    700: "#924a17",
    800: "#6a3614",
    900: "#45230d",
  },
  ink: {
    50: "#f5f6f9",
    100: "#ebecf2",
    200: "#d3d6e0",
    300: "#aeb3c4",
    400: "#8990a8",
    500: "#646d89",
    600: "#4b5573",
    700: "#37415f",
    800: "#262f4a",
    900: "#1b2238",
  },
  sand: {
    white: "#ffffff",
    50: "#fffcf7",
    100: "#faf3e8",
    200: "#f0e5d4",
    300: "#e2d3bc",
    400: "#cbb89c",
  },
  // The PDF names these hues but does not specify hex values.
  green: { 100: "#ddf3dc", 300: "#80cf78", 500: "#2f9e39", 600: "#287f30", 700: "#206326" },
  red: { 100: "#ffe0da", 300: "#fa9789", 500: "#e83f2b", 600: "#bc3021", 700: "#982719" },
  sky: { 100: "#dbecff", 300: "#83bbf4", 500: "#3384d8", 600: "#2468b5", 700: "#1c508d" },
  sun: { 100: "#fff0c3", 300: "#ffd05a", 500: "#f2a900", 600: "#bb7900", 700: "#895900" },
} as const;

/** Portable values use pixels; browser CSS converts lengths to rem. */
export const designTokens = {
  palette: colorPalette,
  colors: {
    bgApp: colorPalette.sand[50],
    surfaceCard: colorPalette.sand.white,
    surfaceSunken: colorPalette.sand[100],
    surfaceBrand: colorPalette.wheat[100],
    borderDefault: colorPalette.sand[200],
    textStrong: colorPalette.ink[900],
    textMuted: colorPalette.ink[600],
    brand: colorPalette.wheat[500],
    brandHover: colorPalette.wheat[700],
    brandInk: colorPalette.wheat[800],
    stateCorrect: colorPalette.green[700],
    stateCorrectSoft: colorPalette.green[100],
    stateWrong: colorPalette.red[600],
    stateWrongHover: colorPalette.red[700],
    stateWrongSoft: colorPalette.red[100],
    stateSelected: colorPalette.sky[600],
    stateSelectedSoft: colorPalette.sky[100],
    stateStreak: colorPalette.sun[700],
    stateStreakSoft: colorPalette.sun[100],
    focus: colorPalette.sky[700],
    onBrand: colorPalette.ink[900],
    onDark: colorPalette.sand.white,
  },
  typography: {
    families: {
      display: '"Fredoka", ui-rounded, sans-serif',
      body: '"Figtree", ui-sans-serif, sans-serif',
      phonetic: '"JetBrains Mono", "Noto Sans Mono", ui-monospace, monospace',
    },
    weights: { regular: 400, semibold: 600, bold: 700, black: 800 },
    styles: {
      h1: { size: 32, lineHeight: 38 },
      h2: { size: 24, lineHeight: 30 },
      h3: { size: 20, lineHeight: 26 },
      bodyLarge: { size: 18, lineHeight: 28 },
      body: { size: 16, lineHeight: 24 },
      bodySmall: { size: 14, lineHeight: 20 },
      caption: { size: 12, lineHeight: 16 },
      overline: { size: 12, lineHeight: 16 },
      displayLarge: { size: 56, lineHeight: 60 },
      displaySmall: { size: 40, lineHeight: 46 },
    },
  },
  spacing: { 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 20, 7: 24, 8: 32, 9: 40, 10: 48, 11: 64, 12: 80 },
  radii: { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 },
  borders: { thin: 1, outlined: 2, chunkyOffset: 4 },
  shadows: {
    card: { x: 0, y: 8, blur: 24, opacity: 0.1, elevation: 3 },
    pop: { x: 0, y: 16, blur: 40, opacity: 0.18, elevation: 8 },
    dialog: { x: 0, y: 20, blur: 56, opacity: 0.22, elevation: 12 },
  },
  motion: {
    durations: { press: 120, ui: 180, reward: 320, wrong: 400, callPulse: 1800 },
    easing: { ui: [0.22, 1, 0.36, 1], reward: [0.2, 1.5, 0.5, 1] },
  },
} as const;

export type DesignTokens = typeof designTokens;

/** React Native consumes the same values, with registered local family names. */
export const nativeDesignTokens = {
  palette: designTokens.palette,
  colors: designTokens.colors,
  spacing: designTokens.spacing,
  radii: designTokens.radii,
  borders: designTokens.borders,
  typography: {
    ...designTokens.typography,
    families: {
      display: "Fredoka",
      body: "Figtree",
      phonetic: "JetBrainsMono",
      phoneticIpa: "NotoSansMono",
    },
  },
  shadows: Object.fromEntries(
    Object.entries(designTokens.shadows).map(([name, shadow]) => [
      name,
      {
        shadowColor: designTokens.colors.textStrong,
        shadowOffset: { width: shadow.x, height: shadow.y },
        shadowOpacity: shadow.opacity,
        shadowRadius: shadow.blur / 2,
        elevation: shadow.elevation,
      },
    ]),
  ),
  motion: {
    ...designTokens.motion,
    reducedDurations: { press: 0, ui: 0, reward: 0, wrong: 0, callPulse: 0 },
  },
} as const;

import { nativeDesignTokens as tokens } from "@call-nina/design-system";
import ninaPhone from "@call-nina/design-system/brand/nina-phone.png";
import { useState, type PropsWithChildren } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type TextProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLocalFonts } from "./NativeFonts";

const textVariants = {
  title: { metrics: tokens.typography.styles.h1, face: "displayBold" },
  heading: { metrics: tokens.typography.styles.h2, face: "bodyBold" },
  subheading: { metrics: tokens.typography.styles.h3, face: "bodyBold" },
  lead: { metrics: tokens.typography.styles.bodyLarge, face: "bodyRegular" },
  body: { metrics: tokens.typography.styles.body, face: "bodyRegular" },
  action: { metrics: tokens.typography.styles.body, face: "bodyBold" },
  overline: { metrics: tokens.typography.styles.overline, face: "bodyBold" },
} as const;

type NativeTextProps = TextProps & {
  variant?: keyof typeof textVariants;
  tone?: "default" | "muted" | "brand";
};

export function NativeText({
  variant = "body",
  tone = "default",
  style,
  ...props
}: NativeTextProps) {
  const localFonts = useLocalFonts();
  const { metrics, face } = textVariants[variant];
  const heading = variant === "title" || variant === "heading" || variant === "subheading";

  return (
    <Text
      accessibilityRole={heading ? "header" : undefined}
      {...props}
      allowFontScaling
      maxFontSizeMultiplier={0}
      style={[
        {
          color:
            tone === "brand"
              ? tokens.colors.brandInk
              : tone === "muted"
                ? tokens.colors.textMuted
                : tokens.colors.textStrong,
          fontSize: metrics.size,
          lineHeight: metrics.lineHeight,
        },
        localFonts
          ? { fontFamily: tokens.typography.families[face] }
          : { fontWeight: face === "bodyRegular" ? "400" : "700" },
        style,
      ]}
    />
  );
}

/** Native safe areas and an unconstrained scroll height keep enlarged text reachable. */
export function NativeScreen({
  children,
  centered = false,
}: PropsWithChildren<{ centered?: boolean }>) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, centered && styles.centered]}>
        <View style={styles.column}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function NativeStack({ children }: PropsWithChildren) {
  return <View style={styles.stack}>{children}</View>;
}

export function NativeCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function NinaMark() {
  return (
    <Image
      accessibilityLabel="Nina peeking over a phone"
      accessibilityRole="image"
      accessible
      resizeMode="contain"
      source={ninaPhone}
      style={styles.brandMark}
    />
  );
}

export function NativeButton({ label, onPress }: { label: string; onPress: () => void }) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        focused && styles.buttonFocused,
      ]}
    >
      <NativeText variant="action" tone="brand" style={styles.buttonText}>
        {label}
      </NativeText>
    </Pressable>
  );
}

// Platform density and touch defaults live here; identity values stay portable.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.bgApp },
  content: {
    flexGrow: 1,
    alignItems: "center",
    gap: tokens.spacing[7],
    padding: tokens.spacing[5],
  },
  centered: { justifyContent: "center" },
  column: { width: "100%", maxWidth: 480, gap: tokens.spacing[7] },
  stack: { gap: tokens.spacing[3] },
  card: {
    gap: tokens.spacing[6],
    padding: tokens.spacing[7],
    backgroundColor: tokens.colors.surfaceCard,
    borderColor: tokens.colors.borderDefault,
    borderWidth: tokens.borders.outlined,
    borderBottomWidth: tokens.borders.chunkyOffset,
    borderRadius: tokens.radii.lg,
  },
  brandMark: { width: tokens.spacing[12], height: tokens.spacing[12] },
  button: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: tokens.spacing[10],
    minHeight: tokens.spacing[10],
    justifyContent: "center",
    gap: tokens.spacing[3],
    paddingHorizontal: tokens.spacing[5],
    paddingVertical: tokens.spacing[4],
    backgroundColor: tokens.colors.surfaceCard,
    borderWidth: tokens.borders.outlined,
    borderColor: tokens.colors.brandInk,
    borderRadius: tokens.radii.md,
  },
  buttonPressed: { backgroundColor: tokens.colors.surfaceBrand },
  buttonFocused: { borderColor: tokens.colors.focus },
  buttonText: { textAlign: "center" },
});

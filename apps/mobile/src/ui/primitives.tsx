import { nativeDesignTokens as tokens } from "@call-nina/design-system";
import ninaPhone from "@call-nina/design-system/brand/nina-phone.png";
import { useState, type PropsWithChildren, type ReactNode } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  type TextProps,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalFonts } from "./NativeFonts";
const variants = {
  title: { metrics: tokens.typography.styles.pageTitle, serif: true, weight: "700" },
  heading: { metrics: tokens.typography.styles.sectionTitle, serif: true, weight: "600" },
  subheading: { metrics: tokens.typography.styles.subsectionTitle, serif: false, weight: "600" },
  lead: { metrics: tokens.typography.styles.bodyLarge, serif: true, weight: "400" },
  body: { metrics: tokens.typography.styles.body, serif: false, weight: "400" },
  action: { metrics: tokens.typography.styles.bodySmall, serif: false, weight: "600" },
  overline: { metrics: tokens.typography.styles.caption, serif: false, weight: "600" },
} as const;
export function NativeText({
  variant = "body",
  tone = "default",
  style,
  ...props
}: TextProps & { variant?: keyof typeof variants; tone?: "default" | "muted" | "brand" }) {
  const loaded = useLocalFonts();
  const face = variants[variant];
  return (
    <Text
      accessibilityRole={
        ["title", "heading", "subheading"].includes(variant) ? "header" : undefined
      }
      {...props}
      allowFontScaling
      style={[
        {
          color:
            tone === "brand"
              ? tokens.colors.actionPrimary
              : tone === "muted"
                ? tokens.colors.textMuted
                : tokens.colors.textStrong,
          fontFamily: loaded
            ? face.serif
              ? tokens.typography.families[`editorial${face.weight}`]
              : tokens.typography.families[`interface${face.weight}`]
            : undefined,
          fontWeight: loaded ? "400" : face.weight,
          fontSize: face.metrics.size,
          lineHeight: face.metrics.lineHeight,
        },
        style,
      ]}
    />
  );
}
export function NativeScreen({
  children,
  centered = false,
  footer,
}: PropsWithChildren<{ centered?: boolean; footer?: ReactNode }>) {
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, centered && styles.centered]}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer && <View style={styles.footer}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function NativeStack({ children }: PropsWithChildren) {
  return <View style={styles.stack}>{children}</View>;
}
export function NativeRow({ children }: PropsWithChildren) {
  return <View style={styles.row}>{children}</View>;
}
export function NativeCard({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}
export function NinaMark() {
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={ninaPhone}
      style={styles.brandMark}
    />
  );
}
export function NativeButton({
  label,
  onPress,
  disabled = false,
  variant = "secondary",
  selected,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "quiet";
  selected?: boolean;
  icon?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.primary,
        variant === "quiet" && styles.quiet,
        selected && styles.selected,
        pressed && (variant === "primary" ? styles.primaryPressed : styles.selected),
        focused && styles.focused,
        disabled && styles.disabled,
      ]}
    >
      {icon}
      <NativeText
        variant="action"
        style={[
          styles.buttonText,
          variant === "primary" && !selected && { color: tokens.colors.onAction },
          disabled && { color: tokens.colors.textDisabled },
        ]}
      >
        {label}
      </NativeText>
    </Pressable>
  );
}
export function NativeField({ label, ...props }: TextInputProps & { label: string }) {
  const fonts = useLocalFonts();
  return (
    <NativeStack>
      <NativeText variant="action">{label}</NativeText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={tokens.colors.textMuted}
        {...props}
        style={[
          styles.input,
          fonts && { fontFamily: tokens.typography.families.interface400 },
          props.style,
        ]}
      />
    </NativeStack>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.colors.bgApp },
  content: { flexGrow: 1, alignItems: "center", padding: tokens.spacing[5] },
  centered: { justifyContent: "center" },
  column: { width: "100%", maxWidth: 720, gap: tokens.spacing[7] },
  stack: { gap: tokens.spacing[3] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing[3], alignItems: "center" },
  card: {
    gap: tokens.spacing[5],
    padding: tokens.spacing[5],
    backgroundColor: tokens.colors.surfaceCard,
    borderColor: tokens.colors.borderDefault,
    borderWidth: tokens.borders.thin,
    borderRadius: tokens.radii.lg,
  },
  footer: {
    padding: tokens.spacing[5],
    gap: tokens.spacing[3],
    borderTopWidth: tokens.borders.thin,
    borderColor: tokens.colors.borderDefault,
    backgroundColor: tokens.colors.bgApp,
  },
  brandMark: { width: tokens.spacing[12], height: tokens.spacing[12] },
  button: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: tokens.spacing[10],
    gap: tokens.spacing[3],
    paddingHorizontal: tokens.spacing[5],
    paddingVertical: tokens.spacing[4],
    backgroundColor: tokens.colors.surfaceCard,
    borderWidth: tokens.borders.thin,
    borderColor: tokens.colors.borderDefault,
    borderRadius: tokens.radii.md,
  },
  primaryPressed: { backgroundColor: tokens.colors.actionPrimaryHover },
  primary: {
    backgroundColor: tokens.colors.actionPrimary,
    borderColor: tokens.colors.actionPrimary,
  },
  quiet: { backgroundColor: "transparent", borderColor: "transparent" },
  selected: { backgroundColor: tokens.colors.surfaceBrand },
  focused: { borderColor: tokens.colors.focus },
  disabled: { backgroundColor: tokens.colors.surfaceDisabled },
  buttonText: { flexShrink: 1, textAlign: "center" },
  input: {
    minHeight: tokens.spacing[10],
    fontSize: tokens.typography.styles.body.size,
    lineHeight: tokens.typography.styles.body.lineHeight,
    color: tokens.colors.textStrong,
    padding: tokens.spacing[4],
    backgroundColor: tokens.colors.surfaceCard,
    borderRadius: tokens.radii.md,
    borderWidth: tokens.borders.thin,
    borderColor: tokens.colors.borderDefault,
  },
});

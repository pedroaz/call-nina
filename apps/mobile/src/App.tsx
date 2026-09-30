import { nativeDesignTokens as designTokens } from "@call-nina/design-system";
import figtree from "@call-nina/design-system/fonts/Figtree-variable.ttf";
import fredoka from "@call-nina/design-system/fonts/Fredoka-variable.ttf";
import jetBrainsMono from "@call-nina/design-system/fonts/JetBrainsMono-variable.ttf";
import notoSansMono from "@call-nina/design-system/fonts/NotoSansMono-variable.ttf";
import ninaPhone from "@call-nina/design-system/brand/nina-phone.png";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export default function App() {
  const [fontsLoaded] = useFonts({
    Fredoka: fredoka,
    Figtree: figtree,
    JetBrainsMono: jetBrainsMono,
    NotoSansMono: notoSansMono,
  });
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Image
              accessibilityLabel="Nina peeking over a phone"
              source={ninaPhone}
              style={styles.brandMark}
            />
            <Text style={styles.eyebrow}>GERMAN, ONE STEP AT A TIME</Text>
            <Text accessibilityRole="header" style={styles.title}>
              Call Nina
            </Text>
            <Text style={styles.description}>A little German, wherever you are.</Text>
            <Text style={styles.notice}>Coming soon on mobile.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  brandMark: { width: 64, height: 64 },
  screen: {
    flex: 1,
    backgroundColor: designTokens.colors.bgApp,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: designTokens.spacing[7],
  },
  card: {
    width: "100%",
    maxWidth: 480,
    gap: designTokens.spacing[5],
    padding: designTokens.spacing[7],
    borderWidth: designTokens.borders.thin,
    borderColor: designTokens.colors.borderDefault,
    borderRadius: designTokens.radii.lg,
    backgroundColor: designTokens.colors.surfaceCard,
  },
  eyebrow: {
    color: designTokens.colors.brandInk,
    fontFamily: designTokens.typography.families.body,
    fontSize: designTokens.typography.styles.overline.size,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    color: designTokens.colors.textStrong,
    fontFamily: designTokens.typography.families.display,
    fontSize: designTokens.typography.styles.h1.size,
    fontWeight: "700",
  },
  description: {
    color: designTokens.colors.textStrong,
    fontFamily: designTokens.typography.families.body,
    fontSize: designTokens.typography.styles.bodyLarge.size,
    lineHeight: designTokens.typography.styles.bodyLarge.lineHeight,
  },
  notice: {
    color: designTokens.colors.textMuted,
    fontFamily: designTokens.typography.families.body,
    fontSize: designTokens.typography.styles.body.size,
    lineHeight: designTokens.typography.styles.body.lineHeight,
  },
});

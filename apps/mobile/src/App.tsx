import { designTokens } from "@call-nina/design-system";
import { StatusBar } from "expo-status-bar";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
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
  screen: {
    flex: 1,
    backgroundColor: designTokens.colors.canvas,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: designTokens.spacing[6],
  },
  card: {
    width: "100%",
    maxWidth: 480,
    gap: designTokens.spacing[4],
    padding: designTokens.spacing[6],
    borderWidth: 1,
    borderColor: designTokens.colors.border,
    borderRadius: designTokens.radii.lg,
    backgroundColor: designTokens.colors.surface,
  },
  eyebrow: {
    color: designTokens.colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    color: designTokens.colors.text,
    fontSize: 36,
    fontWeight: "700",
  },
  description: {
    color: designTokens.colors.text,
    fontSize: 20,
    lineHeight: 28,
  },
  notice: {
    color: designTokens.colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
});

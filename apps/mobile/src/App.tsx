import { nativeDesignTokens as designTokens } from "@call-nina/design-system";
import fontNotices from "@call-nina/design-system/font-notices.json";
import figtreeRegular from "@call-nina/design-system/fonts/Figtree-400.ttf";
import figtreeBold from "@call-nina/design-system/fonts/Figtree-700.ttf";
import fredokaBold from "@call-nina/design-system/fonts/Fredoka-700.ttf";
import jetBrainsMonoRegular from "@call-nina/design-system/fonts/JetBrainsMono-400.ttf";
import notoSansMonoRegular from "@call-nina/design-system/fonts/NotoSansMono-400.ttf";
import ninaPhone from "@call-nina/design-system/brand/nina-phone.png";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

export default function App() {
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    [designTokens.typography.families.displayBold]: fredokaBold,
    [designTokens.typography.families.bodyRegular]: figtreeRegular,
    [designTokens.typography.families.bodyBold]: figtreeBold,
    [designTokens.typography.families.phoneticRegular]: jetBrainsMonoRegular,
    [designTokens.typography.families.phoneticIpaRegular]: notoSansMonoRegular,
  });
  const useLocalFonts = fontsLoaded && !fontError;

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
            <Text style={[styles.eyebrow, useLocalFonts ? styles.bodyBold : styles.systemBold]}>
              GERMAN, ONE STEP AT A TIME
            </Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, useLocalFonts ? styles.displayBold : styles.systemBold]}
            >
              Call Nina
            </Text>
            <Text style={[styles.description, useLocalFonts && styles.bodyRegular]}>
              A little German, wherever you are.
            </Text>
            <Text style={[styles.notice, useLocalFonts && styles.bodyRegular]}>
              Coming soon on mobile.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLicensesOpen(true);
              }}
              style={styles.licenseButton}
            >
              <Text style={[styles.licenseButtonText, useLocalFonts && styles.bodyRegular]}>
                Font licenses
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        <Modal
          animationType="slide"
          onRequestClose={() => {
            setLicensesOpen(false);
          }}
          visible={licensesOpen}
        >
          <SafeAreaView style={styles.licenseScreen}>
            <View style={styles.licenseHeader}>
              <Text
                accessibilityRole="header"
                style={[styles.licenseTitle, useLocalFonts ? styles.bodyBold : styles.systemBold]}
              >
                Font licenses
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLicensesOpen(false);
                }}
                style={styles.closeButton}
              >
                <Text style={[styles.closeText, useLocalFonts && styles.bodyRegular]}>Close</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.licenseContent}>
              {fontNotices.map(({ name, text }) => (
                <View key={name} style={styles.licenseSection}>
                  <Text
                    accessibilityRole="header"
                    style={[
                      styles.licenseHeading,
                      useLocalFonts ? styles.bodyBold : styles.systemBold,
                    ]}
                  >
                    {name}
                  </Text>
                  <Text style={[styles.licenseText, useLocalFonts && styles.bodyRegular]}>
                    {text}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  displayBold: { fontFamily: designTokens.typography.families.displayBold },
  bodyRegular: { fontFamily: designTokens.typography.families.bodyRegular },
  bodyBold: { fontFamily: designTokens.typography.families.bodyBold },
  systemBold: { fontWeight: "700" },
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
    fontSize: designTokens.typography.styles.overline.size,
    letterSpacing: 1,
  },
  title: {
    color: designTokens.colors.textStrong,
    fontSize: designTokens.typography.styles.h1.size,
    lineHeight: designTokens.typography.styles.h1.lineHeight,
  },
  description: {
    color: designTokens.colors.textStrong,
    fontSize: designTokens.typography.styles.bodyLarge.size,
    lineHeight: designTokens.typography.styles.bodyLarge.lineHeight,
  },
  notice: {
    color: designTokens.colors.textMuted,
    fontSize: designTokens.typography.styles.body.size,
    lineHeight: designTokens.typography.styles.body.lineHeight,
  },
  licenseButton: { alignSelf: "flex-start", paddingVertical: designTokens.spacing[3] },
  licenseButtonText: {
    color: designTokens.colors.brandInk,
    fontSize: designTokens.typography.styles.body.size,
    textDecorationLine: "underline",
  },
  licenseScreen: { flex: 1, backgroundColor: designTokens.colors.bgApp },
  licenseHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: designTokens.spacing[4],
    padding: designTokens.spacing[5],
    borderBottomWidth: designTokens.borders.thin,
    borderBottomColor: designTokens.colors.borderDefault,
  },
  licenseTitle: { color: designTokens.colors.textStrong, fontSize: 24 },
  closeButton: { padding: designTokens.spacing[3] },
  closeText: { color: designTokens.colors.brandInk, fontSize: 16 },
  licenseContent: { padding: designTokens.spacing[5], gap: designTokens.spacing[7] },
  licenseSection: { gap: designTokens.spacing[3] },
  licenseHeading: { color: designTokens.colors.textStrong, fontSize: 20 },
  licenseText: {
    color: designTokens.colors.textStrong,
    fontSize: designTokens.typography.styles.body.size,
  },
});

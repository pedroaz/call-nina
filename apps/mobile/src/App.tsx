import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FontLicenses } from "./FontLicenses";
import { NativeFonts } from "./ui/NativeFonts";
import {
  NativeButton,
  NativeCard,
  NativeScreen,
  NativeStack,
  NativeText,
  NinaMark,
} from "./ui/primitives";

export default function App() {
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <SafeAreaProvider>
      <NativeFonts>
        <StatusBar style="dark" />
        <NativeScreen centered>
          <NativeCard>
            <NinaMark />
            <NativeStack>
              <NativeText variant="overline" tone="brand">
                GERMAN, ONE STEP AT A TIME
              </NativeText>
              <NativeText variant="title">Call Nina</NativeText>
            </NativeStack>
            <NativeStack>
              <NativeText variant="lead">A little German, wherever you are.</NativeText>
              <NativeText tone="muted">Coming soon on mobile.</NativeText>
            </NativeStack>
            <NativeButton
              label="Font licenses"
              onPress={() => {
                setLicensesOpen(true);
              }}
            />
          </NativeCard>
        </NativeScreen>
        <FontLicenses
          open={licensesOpen}
          onClose={() => {
            setLicensesOpen(false);
          }}
        />
      </NativeFonts>
    </SafeAreaProvider>
  );
}

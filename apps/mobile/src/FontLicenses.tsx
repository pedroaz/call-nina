import fontNotices from "@call-nina/design-system/font-notices.json";
import { Modal } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NativeButton, NativeScreen, NativeStack, NativeText } from "./ui/primitives";

export function FontLicenses({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    // No transition motion, including for users who request reduced motion.
    <Modal animationType="none" onRequestClose={onClose} visible={open}>
      <SafeAreaProvider>
        <NativeScreen>
          <NativeStack>
            <NativeText variant="heading">Font licenses</NativeText>
            <NativeButton label="Close" onPress={onClose} />
          </NativeStack>
          {fontNotices.map(({ name, text }) => (
            <NativeStack key={name}>
              <NativeText variant="subheading">{name}</NativeText>
              <NativeText>{text}</NativeText>
            </NativeStack>
          ))}
          <NativeButton label="Close" onPress={onClose} />
        </NativeScreen>
      </SafeAreaProvider>
    </Modal>
  );
}

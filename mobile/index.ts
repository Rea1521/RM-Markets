import "expo-router/entry";
import { Platform } from "react-native";

// Android home-screen widget task handler (no-op when the native module is absent, e.g. Expo Go)
if (Platform.OS === "android") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerWidgetTaskHandler } = require("react-native-android-widget");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { widgetTaskHandler } = require("./src/widgets/android");
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch {
    /* widgets unavailable in this runtime */
  }
}

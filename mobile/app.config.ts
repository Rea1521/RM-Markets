import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * RM Markets mobile config.
 *  EXPO_PUBLIC_API_URL  backend URL (e.g. https://rm-markets-api.up.railway.app)
 *  ENABLE_WIDGETS=false disables the native home-screen widget plugins (e.g. for quick simulator builds)
 */
const widgets = process.env.ENABLE_WIDGETS !== "false";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "RM Markets",
  slug: "rm-markets",
  version: "2.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "rmmarkets",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.rmmarkets.app",
    infoPlist: {
      NSMicrophoneUsageDescription: "RM Markets uses the microphone for hands-free voice trading commands.",
      NSSpeechRecognitionUsageDescription: "RM Markets converts your voice commands to text to place demo trades.",
    },
  },
  android: {
    package: "com.rmmarkets.app",
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["RECORD_AUDIO"],
  },
  web: { favicon: "./assets/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-speech-recognition",
      {
        microphonePermission: "RM Markets uses the microphone for hands-free voice trading commands.",
        speechRecognitionPermission: "RM Markets converts your voice commands to text to place demo trades.",
      },
    ],
    ...(widgets
      ? ([
          [
            "expo-widgets",
            {
              widgets: [
                { name: "QuotesWidget", displayName: "Watchlist", description: "Live prices from your RM Markets watchlist", ios: { supportedFamilies: ["systemSmall", "systemMedium"] } },
              ],
            },
          ],
          [
            "react-native-android-widget",
            {
              widgets: [
                { name: "Quotes", label: "RM Markets Watchlist", description: "Live prices from your watchlist", minWidth: "250dp", minHeight: "120dp", targetCellWidth: 4, targetCellHeight: 2, updatePeriodMillis: 1800000 },
              ],
            },
          ],
        ] as ExpoConfig["plugins"] & unknown[])
      : []),
  ],
  experiments: { typedRoutes: false },
  extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL },
});

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "guru.viba.app",
  appName: "VIBA",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
    iosScheme: "https",
    cleartext: false,
    allowNavigation: [
      "viba.guru",
      "www.viba.guru",
      "api.viba.guru",
    ],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#020617",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: "#020617",
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;

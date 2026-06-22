import type { CapacitorConfig } from "@capacitor/cli";

const apiBaseUrl = process.env.VIBA_MOBILE_API_URL ?? "https://viba.guru";

const config: CapacitorConfig = {
  appId: "guru.viba.app",
  appName: "VIBA",
  webDir: "dist/public",
  bundledWebRuntime: false,
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
      style: "DARK",
      backgroundColor: "#020617",
    },
    Keyboard: {
      resize: "body",
      style: "dark",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
export { apiBaseUrl };

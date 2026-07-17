import type { CapacitorConfig } from "@capacitor/cli";

const productionUrl = process.env.VIBA_MOBILE_URL || "https://viba.guru";

const config: CapacitorConfig = {
  appId: "guru.viba.app",
  appName: "VIBA",
  webDir: "dist/public",
  server: {
    url: productionUrl,
    androidScheme: "https",
    iosScheme: "https",
    cleartext: false,
    allowNavigation: [
      "viba.guru",
      "www.viba.guru",
      "api.viba.guru",
      "*.stripe.com",
      "accounts.google.com",
      "github.com",
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

import type { CapacitorConfig } from "@capacitor/cli";

const DEFAULT_URL = "https://viba.guru";
const DEFAULT_APP_ID = "guru.viba.app";
const DEFAULT_APP_NAME = "VIBA";

function safeAppId(value: string | undefined): string {
  const candidate = value?.trim().toLowerCase() || DEFAULT_APP_ID;
  return /^[a-z][a-z0-9]*(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){1,5}$/.test(candidate)
    ? candidate
    : DEFAULT_APP_ID;
}

function safeAppName(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_APP_NAME;
  return candidate.length >= 2 && candidate.length <= 50 && !/[\u0000-\u001f]/.test(candidate)
    ? candidate
    : DEFAULT_APP_NAME;
}

function safeProductionUrl(value: string | undefined): URL {
  try {
    const candidate = new URL(value?.trim() || DEFAULT_URL);
    if (candidate.protocol === "https:" && !candidate.username && !candidate.password) return candidate;
  } catch {
    // Fall through to the verified default.
  }
  return new URL(DEFAULT_URL);
}

const productionUrl = safeProductionUrl(process.env.VIBA_MOBILE_URL);
const appId = safeAppId(process.env.VIBA_MOBILE_BUNDLE_ID);
const appName = safeAppName(process.env.VIBA_MOBILE_APP_NAME);
const navigationHosts = [...new Set([
  productionUrl.hostname,
  "viba.guru",
  "www.viba.guru",
  "api.viba.guru",
  "*.stripe.com",
  "accounts.google.com",
  "github.com",
])];

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "dist/public",
  server: {
    url: productionUrl.toString(),
    androidScheme: "https",
    iosScheme: "https",
    cleartext: false,
    allowNavigation: navigationHosts,
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

import { useLocation } from "wouter";
import { assetUrl, backgrounds, features, hero, type AssetRef } from "@/lib/assets";

type VisualTheme = {
  key: string;
  background: AssetRef;
  accent: AssetRef;
  label: string;
};

const THEMES: Array<{ matches: (path: string) => boolean; theme: VisualTheme }> = [
  {
    matches: (path) => path.startsWith("/sessions") || path.startsWith("/workbench") || path.startsWith("/agent-console") || path.startsWith("/tool-console") || path.startsWith("/bridge"),
    theme: { key: "orchestration", background: backgrounds.circuitGrid, accent: hero.orchestrationCommandCentre, label: "Orchestration workspace" },
  },
  {
    matches: (path) => path.startsWith("/security") || path.startsWith("/credentials") || path.startsWith("/doctor") || path.startsWith("/qa-release-gate") || path.startsWith("/launch-readiness") || path.startsWith("/production-ops"),
    theme: { key: "security", background: backgrounds.dataMatrix, accent: features.secureByDesign, label: "Security and verification" },
  },
  {
    matches: (path) => path.startsWith("/providers") || path.startsWith("/connections") || path.startsWith("/render-connector") || path.startsWith("/domain-setup") || path.startsWith("/project-import"),
    theme: { key: "connections", background: backgrounds.hexNetwork, accent: features.openIntegrations, label: "Connected infrastructure" },
  },
  {
    matches: (path) => path.startsWith("/app-publisher") || path.startsWith("/play-publisher") || path.startsWith("/assisted-browser"),
    theme: { key: "deployment", background: backgrounds.blueAtmosphere, accent: features.oneClickDeployments, label: "Deployment operations" },
  },
  {
    matches: (path) => path.startsWith("/usage") || path.startsWith("/budgets") || path.startsWith("/ai-") || path.startsWith("/seo") || path.startsWith("/advertising") || path.startsWith("/content-creator") || path.startsWith("/brand-outreach"),
    theme: { key: "analytics", background: backgrounds.topographic, accent: features.realTimeAnalytics, label: "Analytics and growth" },
  },
  {
    matches: (path) => path.startsWith("/settings") || path.startsWith("/onboarding") || path.startsWith("/setup-assistant") || path.startsWith("/user-instructions"),
    theme: { key: "configuration", background: backgrounds.purpleAtmosphere, accent: features.customisable, label: "Configuration" },
  },
  {
    matches: (path) => path.startsWith("/dashboard") || path.startsWith("/billing") || path.startsWith("/pricing"),
    theme: { key: "command", background: backgrounds.deepSpace, accent: hero.commandCentre, label: "VIBA command centre" },
  },
];

const FALLBACK_THEME: VisualTheme = {
  key: "intelligence",
  background: backgrounds.gridLines,
  accent: features.globalIntelligence,
  label: "VIBA intelligence",
};

export function AppVisualSystem() {
  const [location] = useLocation();
  const theme = THEMES.find(({ matches }) => matches(location))?.theme ?? FALLBACK_THEME;

  return (
    <div className="viba-app-visual-system" data-visual-theme={theme.key} aria-hidden="true">
      <div
        className="viba-app-background-pattern"
        style={{ backgroundImage: `url(${assetUrl(theme.background)})` }}
      />
      <div className="viba-app-background-glow" />
      <img
        className="viba-app-context-art"
        src={assetUrl(theme.accent)}
        width={theme.accent.width}
        height={theme.accent.height}
        alt=""
        title={theme.label}
      />
    </div>
  );
}

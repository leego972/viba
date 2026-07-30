import type { IconType } from "react-icons";
import {
  SiAnthropic,
  SiCloudflare,
  SiGithub,
  SiGooglegemini,
  SiMistralai,
  SiOllama,
  SiOpenai,
  SiPerplexity,
  SiRailway,
  SiRender,
  SiResend,
  SiStripe,
  SiSupabase,
  SiVercel,
} from "react-icons/si";
import { BrainCircuit, Cloud, PlugZap, Server, Zap } from "lucide-react";

const BRAND_ICONS: Record<string, IconType> = {
  openai: SiOpenai,
  anthropic: SiAnthropic,
  claude: SiAnthropic,
  google: SiGooglegemini,
  gemini: SiGooglegemini,
  mistral: SiMistralai,
  perplexity: SiPerplexity,
  ollama: SiOllama,
  github: SiGithub,
  railway: SiRailway,
  render: SiRender,
  vercel: SiVercel,
  cloudflare: SiCloudflare,
  stripe: SiStripe,
  resend: SiResend,
  supabase: SiSupabase,
};

const FALLBACKS: Record<string, IconType> = {
  custom: PlugZap,
  vastai: Server,
  venice: BrainCircuit,
  openrouter: BrainCircuit,
  together: BrainCircuit,
  fireworks: BrainCircuit,
  neon: Cloud,
  groq: Zap,
  deepseek: BrainCircuit,
};

export function ProviderBrandIcon({
  id,
  className = "h-6 w-6",
  title,
}: {
  id: string;
  className?: string;
  title?: string;
}) {
  const normalised = id.trim().toLowerCase();
  const Icon = BRAND_ICONS[normalised] ?? FALLBACKS[normalised] ?? PlugZap;
  return <Icon className={className} aria-hidden={title ? undefined : true} title={title} />;
}

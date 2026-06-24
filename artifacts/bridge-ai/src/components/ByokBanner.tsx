import { Info, Zap } from "lucide-react";

interface ByokBannerProps {
  className?: string;
}

export function ByokBanner({ className = "" }: ByokBannerProps) {
  return (
    <div className={`rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-4 ${className}`}>
      <div className="flex gap-3">
        <div className="shrink-0 mt-0.5">
          <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="space-y-2 text-sm text-blue-900 dark:text-blue-200">
          <p className="font-medium">
            VIBA works out of the box with Groq as the default fast model.
          </p>
          <p>
            For enhanced performance and collaboration, connect your own AI accounts. You can add OpenAI,
            Claude, Gemini, Perplexity, Replit, Manus, a local model, or any custom AI provider by entering
            its name, endpoint if needed, model if needed, and your API key.
          </p>
          <p>
            Your connected AI keys are <strong>BYOK</strong>. They are stored encrypted in your secure vault
            and used only for your authorized tasks. VIBA does not pay for your third-party AI usage.
          </p>
          <div className="pt-1">
            <p className="font-medium mb-1 flex items-center gap-1.5">
              <Info className="h-4 w-4" /> Use extra AIs for:
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 list-none pl-0">
              {[
                "Deeper code review",
                "Long-context reasoning",
                "Research-heavy work",
                "Specialist security review",
                "Collaborative multi-agent tasks",
                "Production build / deployment analysis",
              ].map((use) => (
                <li key={use} className="flex items-center gap-1.5 text-blue-800 dark:text-blue-300">
                  <span className="text-blue-500">·</span> {use}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

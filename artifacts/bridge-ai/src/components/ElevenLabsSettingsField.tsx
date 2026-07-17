import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Key, Loader2, Trash2 } from "lucide-react";

const SETTING_KEY = "ELEVENLABS_API_KEY";
const MASKED_VALUE = "***SET***";

function isSettingsPage() {
  return window.location.pathname === "/settings" || window.location.pathname.endsWith("/settings");
}

export function ElevenLabsSettingsField() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const locateTarget = () => {
      if (!isSettingsPage()) {
        setPortalTarget(null);
        return;
      }

      const main = document.querySelector("main");
      setPortalTarget(main instanceof HTMLElement ? main : null);
    };

    locateTarget();
    const observer = new MutationObserver(locateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", locateTarget);

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      originalPushState(...args);
      queueMicrotask(locateTarget);
    };
    history.replaceState = (...args) => {
      originalReplaceState(...args);
      queueMicrotask(locateTarget);
    };

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", locateTarget);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    if (!portalTarget) return;

    let cancelled = false;
    setIsLoading(true);
    fetch("/api/settings", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load settings (${response.status})`);
        return response.json();
      })
      .then((settings: Array<{ key: string; value: string | null }>) => {
        if (cancelled) return;
        const existing = settings.find((setting) => setting.key === SETTING_KEY);
        const configured = existing?.value === MASKED_VALUE || Boolean(existing?.value);
        setIsConfigured(configured);
        setValue(configured ? MASKED_VALUE : "");
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Unable to load ElevenLabs settings.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [portalTarget]);

  const displayValue = useMemo(() => (value === MASKED_VALUE ? "" : value), [value]);

  const save = async () => {
    const trimmed = displayValue.trim();
    if (!trimmed && !isConfigured) {
      setMessage("Enter your ElevenLabs API key first.");
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [{ key: SETTING_KEY, value: trimmed || MASKED_VALUE }],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Unable to save key (${response.status})`);
      setIsConfigured(true);
      setValue(MASKED_VALUE);
      setMessage("ElevenLabs API key saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save ElevenLabs API key.");
    } finally {
      setIsSaving(false);
    }
  };

  const clear = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: [{ key: SETTING_KEY, value: "" }] }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Unable to remove key (${response.status})`);
      setIsConfigured(false);
      setValue("");
      setMessage("ElevenLabs API key removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove ElevenLabs API key.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!portalTarget) return null;

  return createPortal(
    <section className="mx-auto mt-6 w-full max-w-6xl px-4 pb-8 sm:px-6 lg:px-8" aria-label="ElevenLabs API settings">
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col gap-2 border-b p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              <h2 className="text-lg font-semibold">ElevenLabs API Key</h2>
            </div>
            {isConfigured && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Enables ElevenLabs voice generation, narration, dubbing, and speech features. The key is masked after saving.
          </p>
        </div>

        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <label htmlFor="elevenlabs-api-key" className="text-sm font-medium">
              API key
            </label>
            <input
              id="elevenlabs-api-key"
              type="password"
              autoComplete="off"
              value={displayValue}
              disabled={isLoading || isSaving}
              onChange={(event) => {
                setValue(event.target.value);
                setMessage(null);
              }}
              placeholder={isConfigured ? "Saved — enter a new key to replace it" : "sk_..."}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">Get the key from your ElevenLabs account settings.</p>
          </div>

          {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isLoading || isSaving}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isConfigured ? "Replace key" : "Save key"}
            </button>

            {isConfigured && (
              <button
                type="button"
                onClick={clear}
                disabled={isSaving}
                className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove key
              </button>
            )}
          </div>
        </div>
      </div>
    </section>,
    portalTarget,
  );
}

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./mobile-visibility.css";
import { ElevenLabsSettingsField } from "./components/ElevenLabsSettingsField";

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    '<div style="padding:2rem;font-family:sans-serif;color:#c00">VIBA failed to mount — root element not found. Please refresh or contact support.</div>';
} else {
  createRoot(rootEl).render(
    <>
      <App />
      <ElevenLabsSettingsField />
    </>,
  );
}

export function installMobileViewportFix() {
  if (typeof window === "undefined") return;

  const setHeight = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty("--viba-viewport-height", `${height}px`);
  };

  document.documentElement.classList.add("viba-mobile-runtime");
  setHeight();
  window.addEventListener("resize", setHeight);
  window.addEventListener("orientationchange", setHeight);
  window.visualViewport?.addEventListener("resize", setHeight);
}

(() => {
  const ADMIN_KEY = "viba_admin_token";
  const ADMIN_LINK_ID = "viba-admin-sidebar-link";
  const DETAILS_BUTTON_ID = "viba-sidebar-details-toggle";

  function hasAdminSession() {
    try {
      return Boolean(sessionStorage.getItem(ADMIN_KEY));
    } catch {
      return false;
    }
  }

  function findDashboardSidebar() {
    const sessionLink = document.querySelector('a[href="/sessions/new"]');
    const nav = sessionLink?.closest("nav");
    const aside = nav?.closest("aside");
    if (!nav || !aside) return null;
    return { nav, aside };
  }

  function syncAdminLink(nav) {
    const existing = document.getElementById(ADMIN_LINK_ID);
    if (!hasAdminSession()) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const link = document.createElement("a");
    link.id = ADMIN_LINK_ID;
    link.href = "/admin";
    link.setAttribute("data-admin-only", "true");
    link.innerHTML = `
      <div class="viba-admin-sidebar-item">
        <span class="viba-admin-sidebar-icon" aria-hidden="true">A</span>
        <span>Admin Dashboard</span>
      </div>
    `;
    nav.appendChild(link);
  }

  function groupSecondaryPanels(aside, nav) {
    const container = nav.parentElement;
    if (!container || document.getElementById(DETAILS_BUTTON_ID)) return;

    const children = Array.from(container.children);
    const navIndex = children.indexOf(nav);
    if (navIndex < 0) return;

    const secondary = children.slice(navIndex + 1);
    if (!secondary.length) return;
    secondary.forEach((node) => node.classList.add("viba-sidebar-secondary"));

    const button = document.createElement("button");
    button.id = DETAILS_BUTTON_ID;
    button.type = "button";
    button.className = "viba-sidebar-details-toggle";
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<span>System details</span><span class="viba-sidebar-chevron" aria-hidden="true">›</span>';
    button.addEventListener("click", () => {
      const open = aside.classList.toggle("viba-sidebar-details-open");
      button.setAttribute("aria-expanded", String(open));
    });
    nav.insertAdjacentElement("afterend", button);
  }

  function apply() {
    const sidebar = findDashboardSidebar();
    if (!sidebar) return;
    syncAdminLink(sidebar.nav);
    groupSecondaryPanels(sidebar.aside, sidebar.nav);
  }

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("storage", apply);
  window.addEventListener("pageshow", apply);
  setInterval(apply, 1000);
  apply();
})();

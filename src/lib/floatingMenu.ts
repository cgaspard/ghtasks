export function floatingMenu(
  node: HTMLElement,
  { anchor, align = "start" }: { anchor: HTMLElement; align?: "start" | "end" },
) {
  const host = node.parentElement?.closest('[role="dialog"][aria-modal="true"]') ?? document.body;
  host.appendChild(node);
  node.dataset.floatingMenu = "";

  function position() {
    const bounds = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = Math.min(Math.max(node.offsetWidth, bounds.width), window.innerWidth - margin * 2);
    const below = window.innerHeight - bounds.bottom - gap - margin;
    const above = bounds.top - gap - margin;
    const upward = below < Math.min(node.scrollHeight, 240) && above > below;
    const available = Math.max(60, upward ? above : below);
    node.style.position = "fixed";
    node.style.width = `${width}px`;
    node.style.minWidth = "0";
    node.style.maxWidth = `${window.innerWidth - margin * 2}px`;
    node.style.maxHeight = `${Math.min(320, available)}px`;
    node.style.left = `${Math.max(margin, Math.min(align === "end" ? bounds.right - width : bounds.left, window.innerWidth - width - margin))}px`;
    node.style.top = `${upward ? Math.max(margin, bounds.top - node.offsetHeight - gap) : bounds.bottom + gap}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
    node.style.margin = "0";
    node.style.zIndex = "1000";
  }

  position();
  const observer = new ResizeObserver(position);
  observer.observe(node);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      node.remove();
    },
  };
}

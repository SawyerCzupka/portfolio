// Page-space mask of where text sits, so the field can recede behind it like
// a map label halo. Built from real line boxes, then blurred into a soft edge.
// Text inside sticky/fixed containers moves with the viewport instead, so those
// containers are returned separately for per-frame viewport-space knockout.

const SCALE = 0.25;
const PAD = 6;

export function buildTextMask() {
  const doc = document.documentElement;
  const [w, h] = [doc.scrollWidth, doc.scrollHeight];
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * SCALE);
  canvas.height = Math.min(4096, Math.ceil(h * SCALE));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(canvas.width / w, canvas.height / h);
  ctx.filter = `blur(${PAD}px)`;
  ctx.fillStyle = "#fff";

  const floating = new Set<Element>();
  const roots = new WeakMap<Element, Element | null>();
  const floatingRoot = (el: Element | null): Element | null => {
    if (!el || el === document.body) return null;
    if (!roots.has(el)) {
      const pos = getComputedStyle(el).position;
      roots.set(el, pos === "sticky" || pos === "fixed" ? el : floatingRoot(el.parentElement));
    }
    return roots.get(el)!;
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      !n.textContent?.trim() || n.parentElement?.closest("script, style, header.sticky, [data-lab-ui]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const root = floatingRoot(n.parentElement);
    if (root) {
      floating.add(root);
      continue;
    }
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      ctx.fillRect(r.left - PAD, r.top + scrollY - PAD, r.width + PAD * 2, r.height + PAD * 2);
    }
  }
  // Figures and code blocks are knocked out whole, so the field never draws over a drawing.
  for (const el of document.querySelectorAll("main svg, main img, main pre")) {
    if (floatingRoot(el)) continue;
    const r = el.getBoundingClientRect();
    ctx.fillRect(r.left, r.top + scrollY, r.width, r.height);
  }
  return { canvas, w, h, floating: [...floating] };
}

/** True if the viewport point is over rendered text or an interactive element. */
export function overContent(x: number, y: number, target: Element | null) {
  if (target?.closest("a, button, input, textarea, select, label, summary, [role=button], svg")) return true;
  const pos = document.caretPositionFromPoint?.(x, y);
  const node = pos?.offsetNode;
  if (!pos || node?.nodeType !== Node.TEXT_NODE || !node.textContent) return false;
  const glyph = document.createRange();
  const i = Math.min(pos.offset, node.textContent.length - 1);
  glyph.setStart(node, Math.max(0, i));
  glyph.setEnd(node, Math.max(0, i) + 1);
  return [...glyph.getClientRects()].some((r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top && y <= r.bottom);
}

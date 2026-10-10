// Islands are content blocks marked `data-island`; the field is not drawn in
// them. Each knockout box is the element grown by its outline offset (where
// the hairline border sits) plus GAP, so glyphs stop short of the border.
// Islands inside sticky/fixed containers move with the viewport, so they are
// measured per frame instead of once in page space.

const GAP = 10;

export type Islands = { page: number[][]; floating: { el: Element; pad: number }[] };

function isFloating(el: Element | null): boolean {
  for (; el && el !== document.body; el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === "sticky" || pos === "fixed") return true;
  }
  return false;
}

const box = (r: DOMRect, pad: number, dy = 0) => [r.x - pad, r.y + dy - pad, r.width + pad * 2, r.height + pad * 2];

export function collectIslands(): Islands {
  const islands: Islands = { page: [], floating: [] };
  for (const el of document.querySelectorAll<HTMLElement>("[data-island]")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const pad = GAP + (el.dataset.island === "bare" ? 0 : parseFloat(getComputedStyle(el).outlineOffset) || 0);
    if (isFloating(el)) islands.floating.push({ el, pad });
    else islands.page.push(box(r, pad, scrollY));
  }
  return islands;
}

/** Knockout boxes (x, y, w, h in CSS px) for one frame: page-space islands near the viewport, floating ones in viewport space. */
export function frameBoxes({ page, floating }: Islands, scroll: number, max: number) {
  const near = page.filter(([, y, , h]) => y < scroll + innerHeight && y + h > scroll);
  const view = floating.map(({ el, pad }) => box(el.getBoundingClientRect(), pad, scroll));
  return [...near, ...view].slice(0, max).flat();
}

const CONTROLS = "a, button, input, textarea, select, label, summary, [role=button], header, [data-island]";

/** True if a pointer press on `target` belongs to the page rather than the field. */
export const overContent = (target: Element | null) => !!target?.closest(CONTROLS);

# lab — ambient evolving NCA

A site-wide background: four species of neural cellular automata compete for
territory, and the weakest is periodically replaced by a mutant of the
strongest. It runs in every page's background via `src/components/LabCanvas.astro`
(mounted in `Base.astro`, `transition:persist` so one world survives client-side
navigation).

## Files

| file | role |
| --- | --- |
| `evolve.ts` | Genomes, population, selection. No GL. The hub seam lives here. |
| `sim.ts` | WebGL2 state: ping-pong float targets, weight texture, stats readback, draw. |
| `shaders.ts` | `STEP` (NCA + physics), `STATS` (territory counts), `PAINT` (seed/erase), `DRAW` (halftone glyphs). |
| `islands.ts` | Measures `data-island` content blocks into knockout boxes; "does this press belong to the page" test for pointer input. |
| `index.ts` | Public API and runtime: RAF loop, scroll, theme ink, pointer, inspection, status. |

## Model

- **State**: 8 channels in two RGBA32F textures. `mass` = per-species mass
  (4 channels; owner = argmax). `hid.xyz` = free hidden channels. `hid.w` =
  food depletion. It is physics-owned, so the net can read it but not write it.
- **Net per species** (`GENOME_LEN` = 1,064): perceive 3×3 (identity + Sobel x/y over
  8 channels = 24) → 32 ReLU → 8 outputs. The weight texture has one row per
  slot. Channels are rotated so a net always sees its own species first, which
  makes genomes slot-independent (needed for migrants).
- **Outputs**: `om.x` modulates own growth, `om.yzw` attack the other species present
  in the cell (attacks cost own mass), `oh.xyz` update hidden channels. Stochastic
  50% fire mask, standard alive mask.
- **Physics the nets can't override**: diffusion, decay, a per-cell capacity of 1,
  growth gated by food (`1 - h.w`), starvation as depletion rises, and food that
  recovers slowly in dead cells. Food is what keeps the world moving. Without it,
  colonies settle into static blobs once space runs out.
- **Global feedback** (CPU, every 30 steps from an 8×8-block readback):
  - growth stalls near the coverage budget (70%);
  - species above 30% share pay an upkeep tax on decay;
  - large species also get a growth tax.

  These stop a single species sweeping the board.

## Evolution

Every 600 steps (~10 s at 60 fps on desktop) `evolve()` replaces the weakest
eligible species with `mutate(best)` (70%) or `crossover(top two)` (30%), reseeding it
in a random disc. Fitness = mean territory share over the epoch.

- **Two-epoch grace**: newcomers can't be culled for two ticks, unless they are
  extinct. Without it a fresh seed is always the weakest, so incumbents are never
  challenged and lineages stall at g1. Tuned with this, a 3 min run typically
  replaces all founders within ~1–2 min and reaches g3–g4.
- A strong founder can legitimately stay the parent for ~2 min. Instantaneous
  shares swing a lot within an epoch, so a snapshot can show the "best" species
  at 5%. Judge by the epoch mean (`fitness`), not `share`.

## Rendering

- **Halftone glyph field**: one mark per cell, sized by mass. Species are legend
  symbols (`GLYPHS`: ● + ○ ×), drawn in the theme's `--color-muted`. The current
  leader is drawn in `--color-accent`. Colours are re-read when `data-theme`
  changes (oklch resolved via a 2D canvas).
- **Scrolls with the page**: the torus is drawn offset by `scrollY`. The world
  is about two viewports tall, so the wrap isn't obvious.
- **Islands**: content blocks are marked `data-island` and get a 1px hairline
  `outline` (`global.css`). `data-island="bare"` is for blocks that already draw
  their own frame or rules (bracket cards, section headings, the footer title
  block): those are knocked out without an outline. `DRAW` skips any cell whose
  centre falls inside an island box (the element grown by its `outline-offset`
  plus a 10px gap), so edges follow the cell grid and no glyph touches a border.
  Islands in sticky/fixed containers are re-measured every frame. Each frame
  passes the islands near the viewport, up to `ISLANDS` (32). Boxes are re-measured
  on navigation (`refresh()`), resize, `document.fonts.ready` and body resize.
- **Overscroll**: the canvas and the margin rails are sticky/absolute rather than
  fixed, so they ride the rubber-band bounce with the page.

## Interaction

The canvas is `pointer-events: none`. Window-level handlers act only when the
press lands outside islands, links, controls and the header (`overContent()`).

- Mouse/pen drag erases. Touch drags are left to page scrolling.
- Click/tap on a live cell inspects. The reticle and specimen card are anchored
  to the clicked page point.
- Escape dismisses.

## Budget and accessibility

- Desktop: 14 px cells, ~104×128 grid, 1 step/frame, DPR ≤ 2.
- Coarse pointer: 12 px cells, steps every other frame (redraws every frame for
  smooth scroll), DPR ≤ 1.5.
- Paused when `document.hidden`.
- `prefers-reduced-motion`: 400 warm-up steps, then a static frame. It still
  redraws on scroll and erase.
- No WebGL2 or `EXT_color_buffer_float`: the canvas is removed and the footer
  status row stays hidden.

## API (for the genome hub, PR 2)

```ts
import { start, stop, refresh, onStatus, onInspect, setHub,
         bestGenomes, injectMigrant, GENOME_LEN, type Genome } from "@/lib/lab";

bestGenomes(n)        // top n by epoch fitness, each with { fitness }
injectMigrant(g)      // replaces the weakest species on the next tick; g.weights.length must be GENOME_LEN
setHub("3 browsers contributing · pool 41")  // fills the footer slot
onStatus(cb)          // { generation, species, lineage, leader, steps, shares, hub }
```

Changing the net shape changes `GENOME_LEN` and the texel offsets hard-coded in
`STEP`, which invalidates any pooled genomes.

## Tuning and verification notes

- The knobs are `GROW/DECAY/STARVE/DIFFUSE/EAT/REGEN` in `STEP`, `BUDGET` and
  `EPOCH_STEPS` and the tax curves in `sim.ts`, and mutation sigma in `evolve.ts`.
- To observe, run headless Chrome on the real GPU (Playwright `channel: "chrome"`,
  `--use-angle=metal`) and sample the population every 15–20 s for 3 min.
  - **Vite gotcha**: `import("/src/lib/lab/evolve.ts")` from the page can return a
    second module instance (after HMR the page's copy has `?t=`). Import the exact
    URL from `performance.getEntriesByType("resource")` instead. Restart the dev
    server between tuning edits, or HMR reloads reset the run.
  - Scroll lock-step check: under reduced motion, screenshot, scroll 200 px,
    screenshot. A 200 px-shifted crop of the margin should diff to 0.
- Untested: real phones, Firefox, integrated-GPU laptops, and the overscroll
  bounce (headless Chrome doesn't rubber-band).

# my²brain — design guidelines ("Atelier")

Replaces the earlier "Q Branch" direction (pure black, sharp angles, Chakra
Petch, actions as underlined text), dropped for a simple reason: it was hard
to read and unpleasant to live in every day. The exact tokens live in the
`:root` blocks of `app/src/styles.css`; the graph skins in
`app/src/palette.ts`. This document fixes the rules of use: every screen must
be justifiable by them.

## Spirit

A workshop: sober, legible, pleasant to open daily. Legibility beats
signature. The interface doesn't try to impress, it tries not to tire.

**Stacked surfaces, not rules.** Four levels, from the back to the front:
`--paper` (the room), `--panel` (sidebar, reader), `--card` (content), `--ctl`
(buttons, fields, chips). An element stands out because it sits higher, not
because it was ringed with a thicker line.

**The glaze.** Every interactive surface carries `--glaze`: a vertical
gradient from white at 5.5% down to zero. Light always falls from above. This
is what gives buttons their relief without any gradient being visible as such.
A glaze must never read as an effect: if you notice it, it's too strong.

**Generous, constant radii.** `--r-lg` (14px) for cards, `--r-md` (10px) for
controls and fields, `--r-sm`/`--r-xs` for small elements, `--r-pill` for
segments, chips and badges. A sharp corner is a mistake, not a variant.

**Soft, short shadows.** `--sh-1` seats a control, `--sh-2` lifts a card,
`--sh-pop` is for the floating reader and for hovering a clickable card. Never
a colored shadow, never a decorative halo.

## Color is semantic and rare

The interface is neutral. A color that appears means something:

- **Blue (`--accent`)**: selection and interaction. The active nav tab, a
  selected chip, a link, the focus ring, the primary action. The standard
  pattern for a selected state is `--accent-soft` fill + `--accent-line` rule
  + `--accent` text.
- **Green (`--ok`)**: a healthy or completed state (active project, done item).
- **Amber (`--amber`)**: attention, without urgency.
- **Red (`--warn`)**: urgency and destruction. Overdue dates, late counters,
  deletion. Nothing else.

Everything else lives on the neutral scale `--f0` → `--f4`. A color added to
"brighten things up" is a fault.

## Typography

- **Inter** is the human voice: titles, navigation, labels, reading. Base
  14px, line-height 1.55, very slightly negative tracking. Useful weights: 450
  (text), 500 (labels), 600 (titles and eyebrows).
- **JetBrains Mono** is the machine voice: dates, counters, paths, code, graph
  labels. Always `tabular-nums` wherever digits align.
- Eyebrows (`.eyebrow`) are uppercase, 10.5px, 0.09em tracking. A sentence
  slipped into an eyebrow (`.hint`) keeps normal case.

Both faces are self-hosted in `app/public/` (`inter-latin*.woff2`,
`jbmono-latin*.woff2`), latin and latin-ext subsets, and the two latin ones
are preloaded in `app/index.html`.

## Anatomy

- **Nav**: one rounded row per destination, filled on hover, diluted blue when
  active. No horizontal separators.
- **Cards**: `--card` + glaze + rule + `--r-lg` + `--sh-2`. On hover the rule
  rises to `--rule-hi`; a clickable card lifts by 2px.
- **Buttons** (`.box`): `--ctl` surface, glaze, rule, `--r-md`. Variants:
  `.ghost` (no surface), `.danger` (red), `.primary` (solid blue). At most one
  solid action per screen.
- **Focus**: never a default `outline`, always `box-shadow: var(--ring)`, a
  3px blue ring. No interactive element may be keyboard-reachable without a
  visible ring.
- **Reader**: a floating panel, 10px off the edges, `--r-xl`, `--sh-pop`. A
  file laid over the room, not a drawer built into it.
- **Background**: a very faint dot grid (26px), behind the graph and the pages
  only. No more line grid.
- **The disc stays** for alert markers and dots: it's the graph's vocabulary,
  and it survives the redesign.

## Two themes, one anatomy

The whole delta between light and dark lives in the tokens. No component
hardcodes a color. Dark is the default (`--paper: #08080a`, never pure black:
pure black crushes the shadows and makes the stack invisible). Light flips the
scale (very pale grey paper, white cards) so the stack stays readable without
multiplying rules. The light | auto | dark switch is a pill segmented control;
**auto** follows sunset and sunrise for the configured location
(`app/src/theme.ts`).

The graph canvas must paint exactly the theme's `--paper`
(`palette.ts` → `GRAPH_SKINS[...].paperCss`), otherwise the graph floats on a
plate of a different value than the room.

## Motion

140ms transitions on color, background, rule, shadow and transform. The
central node's glow breathes, nodes drift by a few pixels. Everything must
switch off cleanly under `prefers-reduced-motion` without anything breaking.

## Forbidden

Purple and hue gradients (the glaze is achromatic). Colored shadows. Frosted
glass over content. Decorative icons, emojis, centered heroes. Noise or
decorative texture. A color that encodes no state. A figure on screen that
doesn't come from a real `/api` route: data is either true or absent.

# my²brain — design guidelines

Two themes, one anatomy. Every visual delta between them lives in the CSS
tokens (`app/src/styles.css`, the `:root` blocks) and in the graph skins
(`app/src/palette.ts` → `GRAPH_SKINS`) — components never hardcode colors.
The theme switch (light | auto | dark) is a segmented control; **auto**
follows sunset/sunrise for the configured location (`app/src/theme.ts`).

## Dark — "observatory" (default)

An analysis screen, not a SaaS dashboard. Pure black paper, off-white ink,
neutral greys, a faint white coordinate grid (minor 24px, major 120px) behind
the graph. Zero hue: the only pigment is a cold console-error red (`--warn`),
reserved for errors and urgency. Interaction re-inks in pure white
(`--accent`), never a tint.

Graph: uniform tiny grey discs (r = 3, size encodes nothing), opacity carries
freshness (premixed toward black — discs stay opaque and mask edges), the
central "me" node is pure white with a slow breathing halo. Labels mono
uppercase under the node, dark halo. Nodes micro-drift ~3px on two superposed
sines (killed by prefers-reduced-motion).

## Light — "Swiss grid"

A printed artifact. White paper, near-black ink, 1px rules, one Swiss red
(`--accent` = `--warn` = #e2231a) for interaction AND urgency. No background
grid — the grid is the dark mode's signature.

Graph: same mechanics (sphere layout, drift, edge trimming), different skin —
node color = file type (categorical print palette in `TYPE_COLORS`), node
size ∝ degree, freshness premixed toward white, red reticle on hover. The
legend shows the color swatches only in this theme.

## Shared language

- **Chakra Petch** is the human voice (titles, navigation, reading); **IBM
  Plex Mono** is the machine voice (dates, counters, paths, code, graph
  labels — `tabular-nums` wherever digits align). Light weights: 400 default,
  never 700+.
- **The disc replaces the square.** Alert dots, replay thumb, badges — all
  discs, the graph's node vocabulary.
- Actions are bare underlined text (no pills, no boxed uppercase buttons).
- Cards are flat panels ringed by a 1px rule; state lives in the content
  (red dates for urgent, opacity for done/past), never in ornaments.
- Data-truth: every figure shown must come from a real API route. No
  decorative metrics.

## Forbidden (AI-slop markers)

Em-dashes anywhere in the interface (rendered as a middot). Floating cards,
gradients, glassmorphism, purple, rounded corners, drop shadows, emojis,
centered heroes, colored pill badges, decorative noise. When in doubt:
could it be printed in a 1972 Swiss report (light) or shown on a mission
screen (dark)?

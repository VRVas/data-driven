# Portfolio UI/UX - Deep Analysis & Revamp Blueprint

> Analysis of `portfolio-aiapps-main` (reference only, never committed) and the plan to
> port its design language - **"Midnight kinetic canvas"** - into the data-driven platform.
> Grounded entirely in the reference source (`packages/design`, `apps/portfolio/src`,
> `port_style_guide`, `docs/DESIGN_LANGUAGE.md`).

## 1. Design philosophy

A **dark, high-performance kinetic canvas**: a near-black *green-tinted* stage (`#0e100f`)
on which **warm cream text** (`#fffce1`, "Frosted Canvas") and a vivid multi-accent palette
do the talking. Interactivity is **outlined, not filled**; motion is **quiet by default,
cinematic on demand**. Everything is flat (no elevation/shadows) - depth comes from color,
blur, grain and motion. The vibe: Framer × Spline × GSAP.com.

Crucially, **our platform already shares its DNA** (dark theme, Stack Sans fonts, violet
accent, GSAP). The revamp is an *elevation*, not a rewrite: adopt the exact palette, the
oversized type scale, the motion vocabulary, and the signature FX layer.

## 2. Color system

| Token | Hex | Role |
|---|---|---|
| Absolute Zero | `#0e100f` | Page background, primary surface |
| Frosted Canvas | `#fffce1` | **Primary text** (warm cream, never pure white) |
| Faded Steel | `#7c7c6f` | Muted text, captions, secondary nav |
| Deep Graphite | `#42433d` | Hairline borders on dark |
| Digital Violet | `#9d95ff` | Accent (brand-ish) |
| Aqua Glow | `#00bae2` | Accent |
| Mint Burst | `#abff84` | Accent (positive) |
| Neon Pink | `#fec5fb` | Accent |
| Fiery Orange | `#ff8709` | Accent |
| Shocking Green | `#0ae448` | Accent |
| Crimson Pulse | `#ff3d57` | Danger / red-team |
| Electric Blue | `#2966ff` | Blue-team |

- **Signature gradient**: `linear-gradient(114.41deg, <from> 20.74%, <to> 65.5%)` - one angle,
  reused everywhere for cohesion. Per-entity gradients pick an accent + a neighbor.
- `::selection` → Digital Violet bg, Absolute Zero text.
- Scrollbars → custom violet→aqua gradient pill (per-surface tintable).

## 3. Typography

- **Display (h1-h3)** → **Stack Sans Notch** (variable, 200-700). **Body/UI** → **Stack Sans
  Text**. **Mono** → **Geist Mono** (eyebrows, kickers, labels, code - `uppercase`,
  `tracking 0.12em`, in Faded Steel with a Frosted-Canvas emphasis word).
- **Scale** (size / leading / tracking): caption 14/1.4/-0.14 - body 18/1.4/-0.18
  subheading 24/1.38/-0.24 - heading-sm 32/1.2/-0.64 - heading 44/1.15/-0.88
  heading-lg 66/1.05/-1.32 - **display 224/0.9/-4.48**. Tight negative tracking scales with size.
- **Hero headline**: `clamp(36px, 5.2vw, 86px)`, leading 1.05, tracking -0.03em.

## 4. Motion vocabulary

Custom eases (cubic-bezier), registered with GSAP `CustomEase` and mirrored as CSS vars:

| Ease | Bezier | Use |
|---|---|---|
| `brandSnap` | `0.22, 1, 0.36, 1` | entrances, reveals |
| `brandSettle` | `0.4, 0, 0.2, 1` | section transitions, magnetic follow |
| `brandReverse` | `0.68, -0.55, 0.27, 1.55` | playful overshoot |
| decelerate / accelerate / smooth | - | body / exits / hovers |

- **Durations**: instant .15 - fast .3 - medium .6 - slow 1 - cinematic 1.6 (s).
- **Staggers**: tight .04 - normal .08 - relaxed .15.
- **Principles**: quiet defaults (350-450ms in, 200ms out); springs for personality, beziers
  for predictability; stagger by index; **`prefers-reduced-motion` is a hard contract**
  (every animation degrades to a static/crossfade state); no animation outlives its content.

## 5. Signature interactions & FX

- **Smooth scroll** - GSAP `ScrollSmoother` (smooth 1.2), desktop + `no-preference` only,
  via `#smooth-wrapper`/`#smooth-content`.
- **Text reveals** - `SplitText`: headlines roll in **line-by-line from behind a mask**
  (`mask:'lines'`, y 100%, brandSnap, stagger .08, ScrollTrigger `top 85%`); hero chars do a
  **spotlight** (blur 4px→0, scale .8→1, stagger from center); subheads reveal word-by-word.
- **Magnetic buttons** - `useMagnetic` (pointer-follow, strength .35, brandSettle→brandSnap);
  premium `MagneticCTA` adds a `CustomWiggle` loop + label-lag (`overwrite:'auto'`).
- **Ambient layers** - `AuroraBackground` (blurred radial gradient bands drifting on a yoyo
  `sine.inOut` timeline, opacity ~0.11-0.2), `ParticleField`/`AppParticles` (rising glowing
  dots that fade+drift), `AmbientBackground` (tinted drifting blobs). All `pointer-events:none`,
  behind content, reduced-motion aware.
- **Stencil headings** - `@property --stencil`; headings render as accent **outline → fill**
  to Frosted Canvas as they enter the reading zone.
- **Border beam** - a comet travels a card's rounded border via CSS `offset-path`.
- **Emphasis marks** - accent text + halo + looping pulse (while on-screen).
- **Custom cursors** - Azure/Copilot SVG marks (default/pointer/text).
- **macOS Dock** - fixed bottom-center floating nav (magnified icons), outside the smooth
  wrapper so it stays truly `fixed`.
- **Chrome** - SSR `InitialLoader` overlay (fades on `window.load`+fonts), `RouteCurtain`
  page transitions, grain overlay (SVG noise, ~6%, `mix-blend`).

## 6. Layout & components

- Ghost **PillButton** (Frosted border, 100px radius, hover fills), gradient **MagneticCTA**,
  **StatusPill** (accent-dot pills), `HoverPopChip`, `Dropdown`, `Tooltip`.
- Radii: **pills 100px** (buttons/tags/nav), **cards 8px**, dividers 1px. **No shadows.**
- Cards: Absolute Zero fill, 2px accent border or Deep Graphite hairline, 16px padding.
- Spacing base 4px; section-gap 34px; comfortable density.

## 7. Port plan → data-driven platform

| Layer | Action |
|---|---|
| Tokens | Rewrite `globals.css @theme` to the Midnight palette + type scale + motion eases; remap our semantic aliases (`--color-bg/ink/brand/border…`) onto it for an instant full reskin |
| Fonts | Keep Stack Sans (already ours); add **Geist Mono** for eyebrows/labels |
| Motion | `src/lib/motion.ts` (curves/durations/staggers) + `src/lib/gsap/register.ts` (plugins + brand eases) |
| Scroll | `SmoothScrollProvider` (ScrollSmoother, desktop-only) + `#smooth-wrapper/content` |
| Hooks | `useMagnetic`, `useRevealLines` |
| FX | `AuroraBackground`, `ParticleField`, `AppParticles`, `GrainOverlay` |
| Primitives | `PillButton`, `MagneticCTA`, `StatusPill`; refactor Badge/buttons → pills |
| Surfaces | Landing hero (char/line reveals, mono eyebrow, aurora, huge display), dashboard shell + nav (restyle; optional dock), cards/KPIs (accent borders, border-beam), tables/quadrant/heatmap tinting |
| Contract | `prefers-reduced-motion` on every animation; keep build + tests green; commit in parts |

The data content differs (BD pipeline vs AI apps) - we adopt the **language and feel**, not
the content: cinematic dark canvas, cream type, vivid accents, oversized headings, magnetic
pills, ambient FX, smooth-scroll reveals, dock-class navigation.

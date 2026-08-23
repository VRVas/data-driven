/**
 * GrainOverlay - fixed film-grain texture over the entire viewport. Pure CSS
 * (see `.grain` in globals.css); server-renderable, no JS.
 */
export function GrainOverlay() {
  return <div aria-hidden className="grain" />;
}

/**
 * Sidecar CSS-module declarations.
 *
 * The copied ui-chat sources originally imported `*.module.css`. To keep the
 * "one CSS class map" rule (and to avoid esbuild's per-file CSS-module naming
 * coupling across 8 stylesheets), build-render.mjs rewrites those imports to
 * `../shims/cssClasses`. This declaration is kept for tooling/IDE parity and
 * documents the shape of every generated class map.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

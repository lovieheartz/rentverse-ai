// CommonJS to match the rest of the package (no `"type": "module"` is declared).
// react-scripts builds its own PostCSS plugin chain and injects Tailwind when it finds
// tailwind.config.js, so this file is what any non-CRA tooling (editor plugins, the
// Tailwind CLI) reads.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

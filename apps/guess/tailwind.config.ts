import type { Config } from "tailwindcss";

// Restrained, editorial, typography-led design system - deliberately NOT
// the generic-SaaS defaults (no bubbly rounding, no drop-shadow stack, no
// gradient utilities defined). Dark mode is the default (CLAUDE.md); every
// hard-coded light value below has a considered dark counterpart via the
// CSS custom properties in globals.css, not via Tailwind's dark: variant
// per color (keeps every component's markup identical across themes).
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
      },
      fontFamily: {
        // System-only stack - no bundled/proprietary font files. Every
        // platform's default UI font here has solid Hebrew coverage.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Noto Sans Hebrew"',
          '"Arial Hebrew"',
          "Arial",
          "sans-serif",
        ],
      },
      // Restrained radii - nothing here reaches Tailwind's default
      // "bubbly" xl/2xl/full scale for structural elements.
      borderRadius: {
        none: "0",
        sm: "3px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "8px",
        full: "999px",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 220ms ease-out both",
        "fade-in": "fade-in 180ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;

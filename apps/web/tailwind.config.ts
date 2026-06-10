import type { Config } from "tailwindcss";

// Brand tokens derived from the ExtSync logo: deep navy, vivid blue, teal.
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2563eb",
          fg: "#ffffff",
          muted: "#dbeafe",
          navy: "#10243E",
          sky: "#2B7DE9",
          teal: "#0FB5BA",
        },
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
      },
      borderRadius: {
        lg: "12px",
        md: "8px",
        sm: "6px",
        xl: "18px",
        "2xl": "24px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,36,62,0.05), 0 1px 8px rgba(16,36,62,0.05)",
        lift: "0 10px 30px -8px rgba(16,36,62,0.18), 0 4px 12px -4px rgba(16,36,62,0.08)",
        glow: "0 0 0 1px rgba(43,125,233,0.15), 0 12px 40px -10px rgba(43,125,233,0.35)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(120deg, #2563EB 0%, #2B7DE9 55%, #0FB5BA 100%)",
        "hero-radial":
          "radial-gradient(60% 60% at 80% 10%, rgba(43,125,233,0.14) 0%, transparent 60%), radial-gradient(50% 50% at 15% 30%, rgba(15,181,186,0.12) 0%, transparent 60%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up .7s cubic-bezier(.21,.8,.35,1) both",
        "fade-in": "fade-in .9s ease both",
        float: "float 6s ease-in-out infinite",
        "spin-slow": "spin-slow 14s linear infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;

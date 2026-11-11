import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Every colour resolves to a design token from app/design.css, so light/dark,
// accent and background presets all work through CSS variables alone.
const v = (name: string) => `var(--${name})`;

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: v("bg"),
        shell: v("shell"),
        foreground: v("fg"),
        "fg-2": v("fg-2"),
        "muted-foreground": v("muted-fg"),
        subtle: v("subtle-fg"),
        card: v("card"),
        "card-2": v("card-2"),
        tab: v("tab"),
        popover: v("popover"),
        border: v("border"),
        "border-strong": v("border-strong"),
        input: v("input"),
        hover: v("hover"),
        active: v("active"),
        primary: v("primary"),
        "primary-foreground": v("primary-fg"),
        brand: v("brand"),
        success: v("success"),
        warning: v("warning"),
        orange: v("orange"),
        danger: v("danger"),
        info: v("info"),
        grid: v("grid"),
        overlay: v("overlay"),
        c20: v("c20"),
        c30: v("c30"),
        cinfra: v("cinfra"),
        cdev: v("cdev"),
        cshared: v("cshared"),
        cunused: v("cunused"),
        cother: v("cother"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "monospace"],
      },
      boxShadow: { card: v("shadow") },
      keyframes: {
        "nt-pulse": {
          "0%": { boxShadow: "0 0 0 0 color-mix(in oklab,var(--danger) 55%,transparent)" },
          "70%": { boxShadow: "0 0 0 7px transparent" },
          "100%": { boxShadow: "0 0 0 0 transparent" },
        },
        "nt-in": { from: { opacity: "0", transform: "translateY(4px) scale(.985)" }, to: { opacity: "1", transform: "none" } },
        "nt-fade": { from: { opacity: "0" }, to: { opacity: "1" } },
        "nt-sheet": { from: { opacity: "0", transform: "translateX(28px)" }, to: { opacity: "1", transform: "none" } },
        "nt-spin": { to: { transform: "rotate(360deg)" } },
        "nt-shimmer": { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } },
      },
      animation: {
        "nt-pulse": "nt-pulse 1.8s ease-out infinite",
        "nt-in": "nt-in .14s ease-out",
        "nt-fade": "nt-fade .15s ease-out",
        "nt-sheet": "nt-sheet .2s ease-out",
        "nt-spin": "nt-spin .8s linear infinite",
        "nt-shimmer": "nt-shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;

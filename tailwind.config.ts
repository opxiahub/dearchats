import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E0C0A",         // deep off-black
        parchment: "#F1EAD8",   // warm cream
        plum: "#3B1F38",        // deep plum accent
        rose: "#C77B6A",        // muted terracotta/rose
        mist: "#A89E91",        // soft taupe for secondary text
        gold: "#C9A961",        // warm gold for highlights
      },
      fontFamily: {
        serif: ['"Fraunces"', '"Source Serif Pro"', "Georgia", "serif"],
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        tight2: "-0.02em",
      },
    },
  },
  plugins: [],
};

export default config;

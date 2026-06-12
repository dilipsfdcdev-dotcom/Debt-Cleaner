/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0e1a",
          800: "#0f1525",
          700: "#161d33",
          600: "#1f2942",
          500: "#2a3654",
        },
        accent: {
          DEFAULT: "#22d3a6",
          dim: "#0f9b7e",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

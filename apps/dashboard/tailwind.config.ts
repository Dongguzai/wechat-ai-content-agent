import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#151515",
        paper: "#f7f6f2",
        line: "#dedbd2",
        moss: "#2f6f5e",
        amber: "#a96f12",
        oxblood: "#8b2d2c",
        steel: "#426173"
      },
      boxShadow: {
        panel: "0 18px 50px rgba(22, 22, 20, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;

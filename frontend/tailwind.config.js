/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "wedding-gold": "#D4AF37",
        "wedding-charcoal": "#2C3539",
        "wedding-cream": "#FDFBF7",
        "wedding-champagne": "#F7E7CE",
      },
      fontFamily: {
        serif: ["Frank Ruhl Libre", "serif"],
        sans: ["Assistant", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 600ms ease-out",
        "slide-up": "slide-up 700ms ease-out",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}


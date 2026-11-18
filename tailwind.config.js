/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'accent-green': '#3B5949', // Muted green from the reference button
        'bg-dark': '#0E1111', // Very dark background
        'sidebar-dark': '#151717',
      }
    },
  },
  plugins: [],
}

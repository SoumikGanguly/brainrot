/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: '#FFFFFF',
        surface: '#F8F9FA',
        accent: '#4F46E5',
        danger: '#EF4444',
        muted: '#6B7280',
        text: '#111827',
      },
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
      },
      fontSize: {
        'xl': '24px',
        'lg': '18px',
        'base': '16px',
        'sm': '14px',
      }
    }
  },
  plugins: []
}
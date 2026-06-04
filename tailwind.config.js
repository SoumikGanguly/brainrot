/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: '#F8F9FC',
        surface: '#F8F9FC',
        card: '#FFFFFF',
        accent: '#5D3DF0',
        danger: '#EF4444',
        muted: '#64748B',
        text: '#0F172A',
      },
      fontFamily: {
        body: ['Inter_400Regular'],
        'body-semibold': ['Inter_600SemiBold'],
        'heading-semibold': ['PlusJakartaSans_600SemiBold'],
        'heading-bold': ['PlusJakartaSans_700Bold'],
      },
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '16px',
        'lg': '24px',
      },
      fontSize: {
        'xl': '24px',
        'lg': '20px',
        'base': '14px',
        'sm': '12px',
        'section': '20px',
        'card-title': '16px',
        'body': '14px',
        'secondary': '12px',
      }
    }
  },
  plugins: []
}

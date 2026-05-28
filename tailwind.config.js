module.exports = {
  content: [
    "./public/**/*.html",
    "./public/**/*.js",
    "./src/**/*.js"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Be Vietnam Pro', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#0C2340',
          light: '#1A73E8',
          pale: '#F8FAFC',
          gold: '#D4AF37',
          teal: '#0D9488',
          rose: '#E11D48'
        },
        accent: {
          DEFAULT: '#D4AF37'
        }
      },
      screens: {
        xs: '380px'
      }
    },
  },
  plugins: [],
}

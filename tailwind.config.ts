import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#121212', // page background
        elevated: '#181818', // cards, sidebar
        highlight: '#1f1f1f', // interactive surfaces, hover
        card: '#252525', // elevated card variant
        press: '#2a2a2a', // pressed state
        border: '#4d4d4d',
        borderLight: '#7c7c7c',
        subdued: '#b3b3b3', // secondary text
        accent: '#1ed760', // Spotify green — functional only
        accentBright: '#3be477',
        accentDark: '#1db954',
        negative: '#f3727f',
        warning: '#ffa42b',
        announce: '#539df5',
      },
      boxShadow: {
        elevated: 'rgba(0,0,0,0.3) 0px 8px 8px',
        dialog: 'rgba(0,0,0,0.5) 0px 8px 24px',
        insetBorder: 'rgb(18,18,18) 0px 1px 0px, rgb(124,124,124) 0px 0px 0px 1px inset',
      },
      fontFamily: {
        display: ['var(--font-display)', 'var(--font-app)', 'sans-serif'],
        sans: [
          'var(--font-app)',
          'Helvetica Neue',
          'helvetica',
          'arial',
          'Hiragino Sans',
          'Meiryo',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;

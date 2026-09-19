/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0f2042', hover: '#1a3460', deep: '#0a1829' },
        amber: {
          DEFAULT: '#e8890c',
          hover: '#cf7a0a',
          light: '#f0a832', // on navy
          text: '#8a5306',
          bg: '#fef5e4',
        },
        canvas: '#f8f7f4',
        'card-alt': '#faf9f6',
        warm: '#ede9e2',
        line: { DEFAULT: '#e0dbd2', strong: '#d5cfc4', divider: '#f1eee8' },
        ink: { DEFAULT: '#2b2b2b', 2: '#4a4a4a' },
        muted: '#6b6b6b',
        faint: '#9aa6ba',
        // On-navy text ramp
        'on-navy': { DEFAULT: '#ffffff', 2: '#dde3ee', 3: '#c9d1e0', 4: '#9aa6ba' },
        ok: { DEFAULT: '#1a8a5a', text: '#166f49', bg: '#e8f7f1' },
        warn: { DEFAULT: '#b8680a', text: '#8a5306', bg: '#fef5e4' },
        bad: { DEFAULT: '#c0392b', text: '#a12f22', bg: '#fdecea', line: '#f3c4bf' },
        info: { text: '#0f2042', bg: '#e8edf6' },
        none: { text: '#6b6b6b', bg: '#ede9e2', 'chip-text': '#9aa6ba', 'chip-bg': '#f1eee8' },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        pill: '99px',
        chip: '4px',
        control: '8px',
        stat: '12px',
        card: '14px',
      },
      maxWidth: {
        content: '1200px',
        import: '960px',
        settings: '1000px',
        portal: '560px',
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'proof-pulse': {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '.35' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
        'proof-pulse': 'proof-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

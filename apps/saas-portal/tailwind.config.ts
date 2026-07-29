import type { Config } from 'tailwindcss';

const config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* Brand colors — ServiceApp palette */
        brand: {
          primary: '#2563EB',
          'primary-hover': '#1D4ED8',
          'primary-light': '#EFF6FF',
          dark: '#1E293B',
          'dark-hover': '#0F172A',
        },
        /* Neutral palette */
        neutral: {
          canvas: '#F8FAFC',
          surface: '#FFFFFF',
          subtle: '#F1F5F9',
          border: '#E2E8F0',
          'border-light': '#F1F5F9',
          text: {
            main: '#0F172A',
            body: '#334155',
            muted: '#64748B',
            placeholder: '#94A3B8',
          },
        },
        /* Status colors */
        status: {
          success: {
            text: '#059669',
            bg: '#ECFDF5',
            border: '#A7F3D0',
          },
          'in-progress': {
            text: '#2563EB',
            bg: '#EFF6FF',
            border: '#BFDBFE',
          },
          warning: {
            text: '#D97706',
            bg: '#FFFBEB',
            border: '#FDE68A',
          },
          danger: {
            text: '#DC2626',
            bg: '#FEF2F2',
            border: '#FECACA',
          },
          neutral: {
            text: '#475569',
            bg: '#F1F5F9',
            border: '#E2E8F0',
          },
          info: {
            text: '#6366F1',
            bg: '#EEF2FF',
            border: '#C7D2FE',
          },
        },
        /* Legacy aliases for shadcn compatibility */
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: 'hsl(var(--card) / <alpha-value>)',
        'card-foreground': 'hsl(var(--card-foreground) / <alpha-value>)',
        popover: 'hsl(var(--popover) / <alpha-value>)',
        'popover-foreground': 'hsl(var(--popover-foreground) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-foreground': 'hsl(var(--primary-foreground) / <alpha-value>)',
        secondary: 'hsl(var(--secondary) / <alpha-value>)',
        'secondary-foreground': 'hsl(var(--secondary-foreground) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        'accent-foreground': 'hsl(var(--accent-foreground) / <alpha-value>)',
        destructive: 'hsl(var(--destructive) / <alpha-value>)',
        'destructive-foreground': 'hsl(var(--destructive-foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        sidebar: 'hsl(var(--sidebar) / <alpha-value>)',
        'sidebar-foreground': 'hsl(var(--sidebar-foreground) / <alpha-value>)',
        'sidebar-primary': 'hsl(var(--sidebar-primary) / <alpha-value>)',
        'sidebar-primary-foreground': 'hsl(var(--sidebar-primary-foreground) / <alpha-value>)',
        'sidebar-accent': 'hsl(var(--sidebar-accent) / <alpha-value>)',
        'sidebar-accent-foreground': 'hsl(var(--sidebar-accent-foreground) / <alpha-value>)',
        'sidebar-border': 'hsl(var(--sidebar-border) / <alpha-value>)',
        'sidebar-ring': 'hsl(var(--sidebar-ring) / <alpha-value>)',
      },
      borderRadius: {
        button: '8px',
        input: '8px',
        card: '12px',
        banner: '16px',
        badge: '9999px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        drawer: '-4px 0 24px rgba(0, 0, 0, 0.12)',
      },
      fontSize: {
        xs: '0.6875rem',
        sm: '0.75rem',
        base: '0.8125rem',
        md: '0.875rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        kpi: '1.875rem',
      },
      spacing: {
        'sidebar-slim': '64px',
        'sidebar-sub': '200px',
        'header-height': '60px',
        'card-pad': '20px',
        'grid-gap': '16px',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--duration-default) var(--ease-in-out)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;

export default config;

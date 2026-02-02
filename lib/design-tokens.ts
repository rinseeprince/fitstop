/**
 * Modernized 2026 Design System Tokens
 * Type-safe constants for consistent styling across the platform
 */

export const spacing = {
  xs: '0.5rem', // 8px
  sm: '1rem', // 16px
  md: '1.5rem', // 24px
  lg: '2rem', // 32px
  xl: '3rem', // 48px
} as const

export const borderRadius = {
  xs: '0.5rem', // 8px - buttons, inputs, badges
  sm: '0.625rem', // 10px
  md: '0.75rem', // 12px - cards, dialogs
  lg: '1rem', // 16px - special elements
  full: '9999px', // circular
} as const

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px rgba(0, 0, 0, 0.07)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
} as const

export const transitions = {
  fast: '150ms ease',
  normal: '250ms ease',
  slow: '350ms ease',
} as const

export const typography = {
  // Font families
  fontSans: '"Inter", "SF Pro Display", "Poppins", "Geist", system-ui, -apple-system, sans-serif',
  fontMono: '"Geist Mono", "Geist Mono Fallback", monospace',

  // Font sizes
  fontSize: {
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px
    base: '1rem', // 16px
    lg: '1.125rem', // 18px
    xl: '1.25rem', // 20px
    '2xl': '1.5rem', // 24px
    '3xl': '2rem', // 32px
    '4xl': '2.25rem', // 36px
  },

  // Font weights
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Line heights
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const

// Chart configuration
export const charts = {
  strokeWidth: {
    thin: 1.5,
    normal: 2,
    thick: 3,
  },
  barWidth: 4,
  barGap: 4,
  gradientOpacity: {
    start: 0.3,
    end: 0.0,
  },
} as const

// Glassmorphism configurations
export const glassmorphism = {
  card: {
    light: 'bg-white/80 backdrop-blur-md border border-white/30',
    dark: 'dark:bg-white/5 dark:border-white/10',
  },
  surface: {
    light: 'bg-white/90 backdrop-blur-md border border-white/40',
    dark: 'dark:bg-white/10 dark:border-white/15',
  },
  heavy: {
    light: 'bg-white/70 backdrop-blur-lg border border-white/20',
    dark: 'dark:bg-black/40 dark:border-white/10',
  },
} as const

// Stat card typography
export const statCard = {
  numberSize: '2.25rem', // 36px
  numberWeight: 600, // semibold
  labelSize: '0.875rem', // 14px
  labelWeight: 500, // medium
  labelColor: '#666',
  labelColorDark: '#999',
} as const

// Animation configurations
export const animations = {
  hover: {
    scale: 1.02,
    transition: transitions.fast,
  },
  press: {
    scale: 0.98,
    transition: transitions.fast,
  },
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.3 },
  },
} as const

// Grid and layout
export const layout = {
  cardGap: spacing.md, // 24px minimum
  sectionGap: spacing.lg, // 32px
  cardPadding: {
    sm: spacing.md, // 24px
    md: spacing.lg, // 32px
  },
  containerMaxWidth: '1400px',
} as const

// Color semantic tokens (for reference)
export const colorTokens = {
  text: {
    primary: '#1a1a1a',
    secondary: '#666666',
    tertiary: '#999999',
    inverse: '#ffffff',
  },
  background: {
    primary: '#fafbfc',
    secondary: '#f8f9fa',
    tertiary: '#ffffff',
  },
} as const

// Type exports for TypeScript
export type Spacing = keyof typeof spacing
export type BorderRadius = keyof typeof borderRadius
export type Shadow = keyof typeof shadows
export type Transition = keyof typeof transitions
export type FontSize = keyof typeof typography.fontSize
export type FontWeight = keyof typeof typography.fontWeight

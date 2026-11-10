// Design tokens – from the Stitch "UniRemote Dark" design system
// (docs/design/). Precision-instrument look: graphite surfaces, one mint
// accent, Space Grotesk headlines, Inter body, JetBrains Mono telemetry.
import type { ButtonColor, RemoteLayout } from '../domain/types';

export const colors = {
  bg: '#0B0D10',
  surface: '#14171C',
  surfaceAlt: '#1B1F26',
  surfaceHi: '#232832',
  border: '#272C35',
  text: '#E8EBF0',
  textDim: '#8C95A5',
  textFaint: '#5A6272',
  accent: '#3EE6B0',
  accentDim: '#123D31',
  accentLine: '#1E5A4A',
  info: '#6C8CFF',
  infoDim: '#18234A',
  warn: '#F5B84B',
  warnDim: '#3A2A10',
  danger: '#FF5C6C',
  dangerDim: '#3D151B',
  cool: '#5AC8FA',
  success: '#3EE6B0',
} as const;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  heading: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_600SemiBold',
} as const;

export const buttonPalette: Record<ButtonColor, { bg: string; fg: string; border: string }> = {
  slate: { bg: '#1B1F26', fg: '#E8EBF0', border: '#2C323C' },
  mint: { bg: '#10352B', fg: '#7CF2CB', border: '#1E5A4A' },
  blue: { bg: '#161F42', fg: '#9DB2FF', border: '#273673' },
  amber: { bg: '#33250E', fg: '#FFD27A', border: '#5C431A' },
  red: { bg: '#371319', fg: '#FF97A2', border: '#5E2029' },
  violet: { bg: '#261740', fg: '#C9A8FF', border: '#432A6B' },
};

/** Tag colours per layout (dashboard cards, remote header). */
export const layoutTag: Record<RemoteLayout, { label: string; fg: string; bg: string }> = {
  custom: { label: 'Custom', fg: colors.textDim, bg: colors.surfaceHi },
  grid2: { label: 'General', fg: colors.textDim, bg: colors.surfaceHi },
  grid3: { label: 'General', fg: colors.textDim, bg: colors.surfaceHi },
  list: { label: 'List', fg: colors.textDim, bg: colors.surfaceHi },
  keyfob: { label: 'Key fob', fg: colors.info, bg: colors.infoDim },
  climate: { label: 'Climate', fg: colors.warn, bg: colors.warnDim },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const type = {
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, letterSpacing: -0.6 },
  h2: { fontFamily: fonts.heading, fontSize: 19, color: colors.text, letterSpacing: -0.2 },
  h3: { fontFamily: fonts.heading, fontSize: 15.5, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  small: { fontFamily: fonts.body, fontSize: 13, color: colors.textDim },
  label: { fontFamily: fonts.monoBold, fontSize: 11, color: colors.textDim, letterSpacing: 1.6, textTransform: 'uppercase' as const },
  mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.text },
  monoSmall: { fontFamily: fonts.mono, fontSize: 11, color: colors.textDim, letterSpacing: 0.4 },
};

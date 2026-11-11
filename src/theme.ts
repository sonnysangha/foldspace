import { useColorScheme, type TextStyle } from 'react-native';

/**
 * One neutral palette per appearance: paper, ink, a single grey fill.
 * Colour belongs to the user's cards and spaces, never to the chrome.
 */
export const lightPalette = {
  paper: '#FFFFFF',
  surface: '#F4F4F2',
  pressed: '#EAEAE7',
  ink: '#141414',
  muted: '#6E6E6A',
  faint: '#A3A3A0',
  line: '#E8E8E5',
  danger: '#C8321E',
  onInk: '#FFFFFF',
  canvas: '#FAFAF9',
  canvasDot: '#DEDEDA',
  cardEdge: '#1414141F',
  cardShadow: '#1414140D',
};

export type Palette = typeof lightPalette;

export const darkPalette: Palette = {
  paper: '#111110',
  surface: '#1E1E1C',
  pressed: '#2A2A27',
  ink: '#F2F2EF',
  muted: '#9C9C97',
  faint: '#6B6B67',
  line: '#2C2C29',
  danger: '#FF6B57',
  onInk: '#141414',
  canvas: '#161615',
  canvasDot: '#30302D',
  cardEdge: '#FFFFFF24',
  cardShadow: '#00000052',
};

/**
 * Cards keep the colour their owner gave them in both appearances, so what is
 * written on a card always uses these fixed inks, never the chrome's.
 */
export const cardInk = { ink: '#141414', muted: '#6E6E6A', faint: '#A3A3A0', line: '#1414141F', onInk: '#FFFFFF' } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;

function typeFor(palette: Palette) {
  return {
    title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.3, color: palette.ink },
    headline: { fontSize: 17, fontWeight: '600', color: palette.ink },
    body: { fontSize: 16, lineHeight: 23, color: palette.ink },
    secondary: { fontSize: 15, lineHeight: 21, color: palette.muted },
    caption: { fontSize: 13, color: palette.muted },
  } as const satisfies Record<string, TextStyle>;
}

const themes = {
  light: { dark: false, palette: lightPalette, type: typeFor(lightPalette) },
  dark: { dark: true, palette: darkPalette, type: typeFor(darkPalette) },
} as const;

export type Theme = (typeof themes)['light' | 'dark'];

/** The chrome colours and text styles for the current appearance. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? themes.dark : themes.light;
}

/** New cards start as plain paper. Colour is something the user adds. */
export const defaultCardColor = '#FFFFFF';
export const spaceColors = ['#141414', '#C8321E', '#2F7D5B', '#2F6DB5', '#8A63B8'];

/** A space's colour as an accent on the chrome. The black swatch becomes ink so it still reads on dark paper. */
export function spaceAccent(color: string, palette: Palette) {
  return color.toUpperCase() === '#141414' ? palette.ink : color;
}

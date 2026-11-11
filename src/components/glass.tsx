import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

const liquid = isLiquidGlassAvailable();

/** A floating control surface: Liquid Glass where the system has it, plain paper elsewhere. */
export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { dark, palette } = useTheme();
  if (liquid) return <GlassView isInteractive colorScheme={dark ? 'dark' : 'light'} style={style}>{children}</GlassView>;
  return <View style={[{ backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)' }, style]}>{children}</View>;
}

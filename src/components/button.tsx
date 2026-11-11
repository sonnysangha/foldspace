import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, useTheme, type Palette } from '@/theme';

const variantsFor = (palette: Palette) => ({
  primary: { backgroundColor: palette.ink, color: palette.onInk },
  secondary: { backgroundColor: palette.surface, color: palette.ink },
  plain: { backgroundColor: 'transparent', color: palette.ink },
  destructive: { backgroundColor: 'transparent', color: palette.danger },
} as const);

/** The one button. Chrome stays black and white; `destructive` is the only colour. */
export function Button({ title, onPress, variant = 'primary', busy = false, disabled = false, testID, accessibilityHint, style }: {
  title: string;
  onPress: () => void;
  variant?: keyof ReturnType<typeof variantsFor>;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const variants = variantsFor(useTheme().palette);
  const inactive = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress} testID={testID}
    style={({ pressed }) => [{
      minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, borderCurve: 'continuous',
      alignItems: 'center', justifyContent: 'center', backgroundColor: variants[variant].backgroundColor, opacity: inactive ? 0.45 : pressed ? 0.7 : 1,
    }, style]}>
    <Text style={{ color: variants[variant].color, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}

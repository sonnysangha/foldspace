import { ActivityIndicator, Text, View } from 'react-native';

import { spacing, useTheme } from '@/theme';

export function LoadingView({ label = 'Opening Foldspace…' }: { label?: string }) {
  const { palette, type } = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper, gap: spacing.md }}>
    <ActivityIndicator color={palette.muted} />
    <Text accessibilityLiveRegion="polite" style={type.caption}>{label}</Text>
  </View>;
}

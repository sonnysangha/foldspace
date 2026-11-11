import { Pressable, Text, View } from 'react-native';

import { spaceAccent, spacing, useTheme } from '@/theme';

/** A single row of colour dots. The selected one gets an ink ring. */
export function ColorSwatches({ options, value, onChange, label }: {
  options: readonly { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const { palette, type } = useTheme();
  return <View style={{ gap: spacing.sm }}>
    <Text style={type.caption}>{label}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
      {options.map(option => {
        const selected = option.value === value;
        return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
          accessibilityState={{ selected, checked: selected }} onPress={() => { if (!selected) onChange(option.value); }}
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: selected ? palette.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: spaceAccent(option.value, palette), borderWidth: 1, borderColor: palette.cardEdge }} />
          </View>
        </Pressable>;
      })}
    </View>
  </View>;
}

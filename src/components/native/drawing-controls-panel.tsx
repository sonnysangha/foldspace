import { Host, Slider } from '@expo/ui';
import type { ComponentProps, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { spaceAccent, spacing, useTheme } from '@/theme';
import { ColorSwatches } from './color-swatches';
import { INK_COLORS, type DrawingControlsProps } from './native-types';

export function DrawingControlsPanel({ color, width, onColorChange, onWidthChange, customColor, sliderModifiers }: DrawingControlsProps & { customColor?: ReactNode; sliderModifiers?: ComponentProps<typeof Slider>['modifiers'] }) {
  const { dark, palette, type } = useTheme();
  return <View style={{ gap: spacing.lg }}>
    <ColorSwatches label="Ink" options={INK_COLORS} value={color} onChange={onColorChange} />
    {customColor}
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
        <Text style={type.caption}>Width</Text>
        <View accessible={false} style={{ flex: 1, height: 24, justifyContent: 'center', alignItems: 'flex-end' }}>
          <View style={{ width: 96, height: width, borderRadius: width / 2, backgroundColor: spaceAccent(color, palette) }} />
        </View>
      </View>
      <Host style={{ height: 44 }} seedColor={palette.ink} colorScheme={dark ? 'dark' : 'light'}>
        <Slider value={width} min={1} max={18} step={1} onValueChange={onWidthChange} testID="drawing-stroke-width" modifiers={sliderModifiers} />
      </Host>
    </View>
  </View>;
}

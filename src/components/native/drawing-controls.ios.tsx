import { Host } from '@expo/ui';
import { ColorPicker } from '@expo/ui/swift-ui';
import { accessibilityIdentifier, accessibilityLabel } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '@/theme';
import { DrawingControlsPanel } from './drawing-controls-panel';
import type { DrawingControlsProps } from './native-types';

export function DrawingControls(props: DrawingControlsProps) {
  const { dark, palette } = useTheme();
  return <DrawingControlsPanel {...props} sliderModifiers={[accessibilityLabel('Stroke width')]} customColor={
    <Host style={{ height: 44 }} seedColor={palette.ink} colorScheme={dark ? 'dark' : 'light'}>
      <ColorPicker label="Custom ink" selection={props.color} supportsOpacity={false}
        onSelectionChange={props.onColorChange} modifiers={[accessibilityIdentifier('drawing-ink-color')]} />
    </Host>
  } />;
}

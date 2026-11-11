import { Host } from '@expo/ui';
import { ArrangementView, RNHostView, VStack } from '@expo/ui/swift-ui';
import { arrangementViewStyle, frame, ignoreSafeArea, splitArrangementLayoutRatio, splitArrangementLayoutSize } from '@expo/ui/swift-ui/modifiers';
import { useHinge } from 'expo-hinge';
import { Platform, StyleSheet, View } from 'react-native';

import type { DuoLayoutProps } from './native-types';

const fill = frame({ maxWidth: Infinity, maxHeight: Infinity });
const collapsed = [frame({ width: 0, height: 0 }), splitArrangementLayoutSize({
  minWidth: 0, idealWidth: 0, maxWidth: 0,
  minHeight: 0, idealHeight: 0, maxHeight: 0,
})];

export function DuoLayout({ primary, secondary, wide, showSecondary, secondaryColor }: DuoLayoutProps) {
  const hinge = useHinge();
  // Native ArrangementView can collapse a pane in an ordinary phone's compact-height
  // environment. A flex split keeps both tools available on those displays.
  if (!hinge || Number.parseFloat(String(Platform.Version)) < 27.1) {
    if (!wide || !showSecondary) {
      return <View style={styles.fill}>{showSecondary ? secondary : primary}</View>;
    }
    return (
      <View style={styles.row}>
        <View style={styles.primary}>{primary}</View>
        <View style={styles.secondary}>{secondary}</View>
      </View>
    );
  }

  // A split arrangement divides the screen at the hinge whenever the device is half open,
  // even with an empty second pane. With nothing to show beside it, the canvas is laid out
  // on its own so it keeps the whole screen in every pose. The hierarchy only changes when
  // a pane opens or closes, never during a fold.
  if (!showSecondary) return <View style={styles.fill}>{primary}</View>;

  // Keep the focused native editor in the same host and slot as the display changes.
  // Replacing its entire hosting hierarchy while it is first responder can terminate
  // the app during the outer-to-inner display handoff.
  const primaryVisible = wide || !showSecondary;
  const secondaryVisible = showSecondary;
  const primaryRatio = wide && showSecondary
    ? splitArrangementLayoutRatio({ idealHorizontal: 0.62, idealVertical: 0.48 })
    : splitArrangementLayoutRatio(1);
  const editorSize = splitArrangementLayoutSize({ minWidth: 320, idealWidth: 420, maxWidth: 560, minHeight: 220, idealHeight: 360 });

  return (
    // Half open, the system keeps a strip clear on each side of the hinge. Painting it in the
    // second pane's colour makes that pane reach the canvas, with no blank band in the middle.
    <Host style={[styles.fill, { backgroundColor: secondaryColor }]}>
      {/* Panes run to the screen edges, under the system's side bar; each pane insets its own content. */}
      <ArrangementView modifiers={[arrangementViewStyle('split', { axes: 'both' }), fill, ignoreSafeArea({ regions: 'container', edges: 'all' })]}>
        <ArrangementView.Primary>
          <VStack spacing={0} modifiers={primaryVisible ? [fill, primaryRatio] : collapsed}>
            <RNHostView><View style={styles.fill} accessibilityElementsHidden={!primaryVisible} pointerEvents={primaryVisible ? 'auto' : 'none'}>{primary}</View></RNHostView>
          </VStack>
        </ArrangementView.Primary>
        <ArrangementView.Secondary>
          <VStack spacing={0} modifiers={secondaryVisible ? [fill, editorSize] : collapsed}>
            <RNHostView><View style={styles.fill} accessibilityElementsHidden={!secondaryVisible} pointerEvents={secondaryVisible ? 'auto' : 'none'}>{secondary}</View></RNHostView>
          </VStack>
        </ArrangementView.Secondary>
      </ArrangementView>
    </Host>
  );
}

export default DuoLayout;

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0, minHeight: 0 },
  row: { flex: 1, flexDirection: 'row', minWidth: 0, minHeight: 0 },
  primary: { flex: 1.6, minWidth: 0, minHeight: 0 },
  secondary: { flex: 1, minWidth: 0, minHeight: 0 },
});

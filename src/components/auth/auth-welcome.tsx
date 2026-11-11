import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cardInk, spacing, useTheme } from '@/theme';

const points: { icon: SymbolViewProps['name']; text: string }[] = [
  { icon: { ios: 'rectangle.on.rectangle', android: 'layers', web: 'layers' }, text: 'Every card opens into its own canvas' },
  { icon: { ios: 'pencil.tip', android: 'draw', web: 'draw' }, text: 'Type, sketch, and pin photos, places and voice' },
  { icon: { ios: 'arrow.triangle.2.circlepath', android: 'sync', web: 'sync' }, text: 'Live on every device you sign in to' },
];

function Line({ width, strong }: { width: number | `${number}%`; strong?: boolean }) {
  return <View style={{ width, height: strong ? 6 : 4, borderRadius: 3, backgroundColor: strong ? cardInk.ink : cardInk.faint, opacity: strong ? 0.85 : 0.7 }} />;
}

function Sheet({ color, delay, tilt, style, children }: { color: string; delay: number; tilt: number; style: ViewStyle; children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(420)} style={[{ position: 'absolute' }, style]}>
      {/* The tilt sits inside: the entering animation owns the outer view's transform. */}
      <View style={{
        flex: 1, padding: 12, gap: 7, borderRadius: 12, borderCurve: 'continuous', backgroundColor: color, transform: [{ rotate: `${tilt}deg` }],
        borderWidth: 1, borderColor: palette.cardEdge, boxShadow: `0 6px 18px ${palette.cardShadow}`,
      }}>{children}</View>
    </Animated.View>
  );
}

/** Three cards from a canvas: a note, a card with a canvas inside it, and a list. Decorative only. */
function CanvasArt({ scale = 1 }: { scale?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
      style={{ width: 300 * scale, height: 150 * scale }}>
      <View style={{ width: 300, height: 150, transformOrigin: 'top left', transform: [{ scale }] }}>
        <Sheet color="#FFF0BF" delay={0} tilt={-6} style={{ left: 6, top: 22, width: 104, height: 104 }}>
          <Line width="70%" strong />
          <Line width="100%" />
          <Line width="88%" />
          <Line width="54%" />
        </Sheet>
        <Sheet color="#DCECE7" delay={90} tilt={3} style={{ left: 96, top: 4, width: 124, height: 132 }}>
          <Line width="56%" strong />
          <View style={{ flex: 1, borderRadius: 8, borderCurve: 'continuous', backgroundColor: '#FFFFFFB8', padding: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <View style={{ width: 38, height: 30, borderRadius: 5, backgroundColor: '#FFF0BF' }} />
            <View style={{ width: 38, height: 30, borderRadius: 5, backgroundColor: '#E4E0F5' }} />
            <View style={{ width: 38, height: 22, borderRadius: 5, backgroundColor: '#F9DCCA' }} />
            <View style={{ width: 38, height: 22, borderRadius: 5, backgroundColor: '#D9E8F5' }} />
          </View>
        </Sheet>
        <Sheet color="#E4E0F5" delay={180} tilt={-3} style={{ left: 204, top: 34, width: 92, height: 96 }}>
          <Line width="64%" strong />
          {[0, 1, 2].map(row => (
            <View key={row} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 9, height: 9, borderRadius: 3, borderWidth: 1.5, borderColor: cardInk.ink, backgroundColor: row === 0 ? cardInk.ink : 'transparent', opacity: 0.8 }} />
              <View style={{ flex: 1 }}><Line width={row === 1 ? '72%' : '100%'} /></View>
            </View>
          ))}
        </Sheet>
      </View>
    </View>
  );
}

export function AuthWelcome({ children }: { children: ReactNode }) {
  const { palette, type } = useTheme();
  const { width, height, fontScale } = useWindowDimensions();
  const isWide = width >= 740;
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  // The sign-in form keeps its slot; the introduction gives way when space is tight.
  const roomy = !keyboardVisible && fontScale <= 1.25;
  const showArt = isWide ? height >= 520 : roomy && height >= 800;
  const showDescription = isWide || (roomy && height >= 700);

  const name = (
    <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: isWide ? 40 : 30, fontWeight: '700', letterSpacing: isWide ? -1.2 : -0.8 }}>Foldspace</Text>
  );
  const description = showDescription && (
    <Text style={[type.secondary, { fontSize: isWide ? 18 : 16, lineHeight: isWide ? 26 : 22, maxWidth: 360, textAlign: isWide ? 'left' : 'center' }]}>
      Notes and sketches on a canvas, with canvases inside your cards.
    </Text>
  );

  if (isWide) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper }}>
        {/* Clerk's form starts at the top of its slot, so the introduction lines up with it there. */}
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 40, paddingTop: 56, paddingBottom: spacing.xl, gap: spacing.xxl }}>
          <View style={{ flex: 1, maxWidth: 440, gap: spacing.lg }}>
            {showArt && <CanvasArt scale={1.25} />}
            <View style={{ gap: spacing.sm, marginTop: showArt ? spacing.lg : 0 }}>
              {name}
              {description}
            </View>
            <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
              {points.map(point => (
                <View key={point.text} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <SymbolView name={point.icon} size={20} tintColor={palette.ink} style={{ width: 24, height: 24 }} />
                  <Text style={[type.body, { flex: 1 }]}>{point.text}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ flex: 1.2, maxWidth: 560, overflow: 'hidden', backgroundColor: palette.paper }}>{children}</View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper }}>
      <View style={{ flex: 1, paddingTop: showArt ? spacing.xl : spacing.lg, gap: spacing.sm }}>
        <View style={{ alignItems: 'center', paddingHorizontal: spacing.xl, gap: spacing.xs }}>
          {showArt && <View style={{ marginBottom: spacing.md }}><CanvasArt /></View>}
          {name}
          {description}
        </View>
        <View style={{ flex: 1, minHeight: 120, overflow: 'hidden', backgroundColor: palette.paper }}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

export function AuthProgress({ message = 'Opening your spaces…', account }: { message?: string; account?: ReactNode }) {
  const { palette, type } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', gap: spacing.lg, padding: spacing.xxl }}>
        <ActivityIndicator color={palette.muted} accessibilityLabel="Loading" />
        <Text accessibilityLiveRegion="polite" style={[type.secondary, { textAlign: 'center' }]}>{message}</Text>
        {account}
      </View>
    </SafeAreaView>
  );
}

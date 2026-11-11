import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';

import { cardInk, spacing } from '@/theme';
import { formatDuration, waveform } from '@/utils/waveform';

/** Plays a voice note: a round play button, its waveform filling as it plays, and the time. */
export function VoicePlayer({ id, url, duration, width }: { id: string; url: string; duration: number; width: number }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const total = status.duration || duration || 0;
  const progress = total ? Math.min(1, status.currentTime / total) : 0;
  const started = status.playing || status.currentTime > 0;
  const bars = waveform(id, Math.max(12, Math.floor((width - 56 - spacing.md) / 5)));
  const toggle = () => {
    if (status.playing) { player.pause(); return; }
    if (total && status.currentTime >= total - 0.05) void player.seekTo(0);
    player.play();
  };

  return <View style={{ width, gap: spacing.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'} testID="voice-play" onPress={toggle}
        style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, backgroundColor: cardInk.ink, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
        <SymbolView name={status.playing ? { ios: 'pause.fill', android: 'pause', web: 'pause' } : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }} size={22} tintColor={cardInk.onInk} />
      </Pressable>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flex: 1, height: 56, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {bars.map((level, index) => <View key={index} style={{ flex: 1, height: 8 + level * 44, borderRadius: 2, backgroundColor: index / bars.length < progress ? cardInk.ink : cardInk.faint }} />)}
      </View>
    </View>
    <Text style={{ fontSize: 15, color: cardInk.muted, fontVariant: ['tabular-nums'], marginLeft: 56 + spacing.md }}>
      {started ? `${formatDuration(status.currentTime)} / ${formatDuration(total)}` : formatDuration(total)}
    </Text>
  </View>;
}

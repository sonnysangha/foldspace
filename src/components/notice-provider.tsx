import { createContext, use, useCallback, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/theme';

type NoticeAction = { label: string; onPress: () => void };
type Notice = { message: string; action?: NoticeAction };

const NoticeContext = createContext<(message: string, action?: NoticeAction) => void>(() => {});
export const useNotice = () => use(NoticeContext);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(null);
  }, []);
  const show = useCallback((message: string, action?: NoticeAction) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ message, action });
    // An undoable notice stays a little longer so the action is reachable.
    timer.current = setTimeout(() => setNotice(null), action ? 7000 : 4000);
  }, []);

  return <NoticeContext value={show}>
    <View style={{ flex: 1 }}>{children}</View>
    {notice && <View pointerEvents="box-none" style={{ position: 'absolute', bottom: insets.bottom + 72, left: insets.left + spacing.lg, right: insets.right + spacing.lg, alignItems: 'center' }}>
      <View accessibilityRole="alert" testID="notice" style={{
        maxWidth: 480, flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: palette.ink,
        paddingLeft: spacing.lg, paddingRight: notice.action ? spacing.xs : spacing.lg, borderRadius: radius.md, borderCurve: 'continuous',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.14)',
      }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${notice.message}. Dismiss`} onPress={hide} style={{ flexShrink: 1, minHeight: 44, justifyContent: 'center', paddingVertical: spacing.md }}>
          <Text style={{ color: palette.onInk, fontSize: 15, lineHeight: 20 }}>{notice.message}</Text>
        </Pressable>
        {notice.action && <Pressable accessibilityRole="button" testID="notice-action" onPress={() => { const { onPress } = notice.action!; hide(); onPress(); }}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: palette.onInk, fontSize: 15, fontWeight: '700' }}>{notice.action.label}</Text>
        </Pressable>}
      </View>
    </View>}
  </NoticeContext>;
}

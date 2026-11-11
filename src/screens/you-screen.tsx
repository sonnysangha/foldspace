import { useClerk, useUser } from '@clerk/expo';
import { useMutation, useQuery } from 'convex/react';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import { useNotice } from '@/components/notice-provider';
import { radius, spacing, useTheme } from '@/theme';
import { setAppearance, useAppearance, type AppearanceChoice } from '@/utils/appearance';
import { displayName } from '@/utils/display-name';
import { errorMessage } from '@/utils/error-message';

type Icon = SymbolViewProps['name'];

const appearances: { value: AppearanceChoice; label: string; icon: Icon }[] = [
  { value: 'system', label: 'System', icon: { ios: 'circle.lefthalf.filled', android: 'contrast', web: 'contrast' } },
  { value: 'light', label: 'Light', icon: { ios: 'sun.max', android: 'light_mode', web: 'light_mode' } },
  { value: 'dark', label: 'Dark', icon: { ios: 'moon', android: 'dark_mode', web: 'dark_mode' } },
];

function Section({ title, children }: { title?: string; children: ReactNode }) {
  const { palette, type } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {title && <Text accessibilityRole="header" style={[type.caption, { paddingHorizontal: spacing.xs }]}>{title}</Text>}
      <View style={{ borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: palette.surface, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

function Row({ icon, label, detail, onPress, danger, last, busy, external, testID }: {
  icon: Icon; label: string; detail?: string; onPress?: () => void; danger?: boolean; last?: boolean; busy?: boolean; external?: boolean; testID?: string;
}) {
  const { palette } = useTheme();
  const color = danger ? palette.danger : palette.ink;
  return (
    <Pressable accessibilityRole={onPress ? (external ? 'link' : 'button') : 'text'} accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: busy, busy }} disabled={!onPress || busy} onPress={onPress} testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, backgroundColor: pressed ? palette.pressed : 'transparent', opacity: busy ? 0.5 : 1 })}>
      <SymbolView name={icon} size={19} tintColor={color} style={{ width: 24, height: 24 }} />
      <View style={{ flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: palette.line }}>
        <Text style={{ flex: 1, fontSize: 16, color }}>{label}</Text>
        {!!detail && <Text numberOfLines={1} style={{ fontSize: 15, color: palette.muted, flexShrink: 1 }}>{detail}</Text>}
        {onPress && !danger && <SymbolView name={external ? { ios: 'arrow.up.right', android: 'open_in_new', web: 'open_in_new' } : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={12} weight="semibold" tintColor={palette.faint} style={{ width: 14, height: 14 }} />}
      </View>
    </Pressable>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const { palette, type } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, padding: spacing.md, gap: 2, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: palette.surface }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.3, color: palette.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

export function YouScreen() {
  const { palette, type } = useTheme();
  const { width } = useWindowDimensions();
  const { user } = useUser();
  const { signOut } = useClerk();
  const spaces = useQuery(api.workspaces.list);
  const seed = useMutation(api.workspaces.seedDemo);
  const appearance = useAppearance();
  const notice = useNotice();
  const [busy, setBusy] = useState<'example' | 'signOut' | null>(null);
  const lock = useRef(false);

  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const name = displayName(user) || 'You';
  const initial = name.trim().charAt(0).toUpperCase();
  const mine = spaces?.filter(space => space.role === 'owner');
  const cards = mine?.reduce((total, space) => total + space.cardCount, 0);
  const joined = user?.createdAt?.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const hasExample = spaces?.some(space => space.isDemo);

  const run = async (key: 'example' | 'signOut', task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    try { await task(); } catch (error) { notice(errorMessage(error, 'That did not work. Check your connection and try again.')); } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const openExample = () => run('example', async () => {
    const result = await seed({});
    router.push({ pathname: '/workspace/[id]', params: { id: result._id } });
  });

  const confirmSignOut = () => Alert.alert('Sign out of Foldspace?', 'Your spaces stay saved to your account.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => { void run('signOut', () => signOut()); } },
  ]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: palette.paper }}
      contentContainerStyle={{ width: Math.min(width, 620), alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${email}. Manage account`} testID="you-profile"
        onPress={() => router.push('/manage-account')}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, opacity: pressed ? 0.7 : 1 })}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Text style={{ fontSize: 26, fontWeight: '600', color: palette.muted }}>{initial}</Text>
          {!!user?.imageUrl && <Image source={user.imageUrl} contentFit="cover" transition={150} style={{ position: 'absolute', width: 68, height: 68 }} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={type.title}>{name}</Text>
          {!!email && <Text numberOfLines={1} selectable style={type.secondary}>{email}</Text>}
        </View>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Stat value={mine ? String(mine.length) : '–'} label={mine?.length === 1 ? 'Space' : 'Spaces'} />
        <Stat value={cards === undefined ? '–' : String(cards)} label={cards === 1 ? 'Card' : 'Cards'} />
        <Stat value={joined ?? '–'} label="Joined" />
      </View>

      <Section title="Account">
        <Row icon={{ ios: 'person.text.rectangle', android: 'badge', web: 'badge' }} label="Manage account" detail="Profile and security" testID="manage-account"
          onPress={() => router.push('/manage-account')} last />
      </Section>

      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={[type.caption, { paddingHorizontal: spacing.xs }]}>Appearance</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: spacing.sm }}>
          {appearances.map(item => {
            const selected = item.value === appearance;
            return (
              <Pressable key={item.value} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: selected, selected }}
                testID={`appearance-${item.value}`} onPress={() => setAppearance(item.value)}
                style={({ pressed }) => ({
                  flex: 1, alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous',
                  backgroundColor: palette.surface, borderWidth: 1.5, borderColor: selected ? palette.ink : palette.surface, opacity: pressed ? 0.7 : 1,
                })}>
                <SymbolView name={item.icon} size={20} tintColor={selected ? palette.ink : palette.muted} style={{ width: 24, height: 24 }} />
                <Text style={{ fontSize: 15, fontWeight: selected ? '600' : '400', color: palette.ink }}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Section title="More spaces">
        <Row icon={{ ios: 'person.2', android: 'group_add', web: 'group_add' }} label="Join a shared space" testID="join-space"
          onPress={() => router.push('/join')} last={hasExample !== false} />
        {hasExample === false && (
          <Row icon={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} label={busy === 'example' ? 'Opening…' : 'Open the example space'} testID="you-open-example"
            busy={busy === 'example'} onPress={() => { void openExample(); }} last />
        )}
      </Section>

      <Section title="About">
        <Row icon={{ ios: 'chevron.left.forwardslash.chevron.right', android: 'code', web: 'code' }} label="Source code" external
          onPress={() => { void Linking.openURL('https://github.com/sonnysangha/foldspace'); }} />
        <Row icon={{ ios: 'person.3', android: 'groups', web: 'groups' }} label="Join the community" external
          onPress={() => { void Linking.openURL('https://www.papareact.com/ztoh-form'); }} />
        <Row icon={{ ios: 'info.circle', android: 'info', web: 'info' }} label="Version" detail={Constants.expoConfig?.version ?? '1.0.0'} last />
      </Section>

      <Section>
        <Row icon={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} label={busy === 'signOut' ? 'Signing out…' : 'Sign out'} danger last
          busy={busy === 'signOut'} onPress={confirmSignOut} testID="sign-out" />
      </Section>
    </ScrollView>
  );
}

import { useUser } from '@clerk/expo';
import { useMutation, useQuery } from 'convex/react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Button } from '@/components/button';
import { useNotice } from '@/components/notice-provider';
import { radius, spacing, useTheme } from '@/theme';
import { displayName } from '@/utils/display-name';
import { errorMessage } from '@/utils/error-message';

const spaced = (code: string) => code.match(/.{1,4}/g)?.join('-') ?? code;

function Person({ name, detail, onRemove }: { name: string; detail: string; onRemove?: () => void }) {
  const { palette, type } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: palette.muted }}>{name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, color: palette.ink }}>{name}</Text>
        <Text style={type.caption}>{detail}</Text>
      </View>
      {onRemove && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} hitSlop={10} onPress={onRemove}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 15, color: palette.danger }}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Who can open a space. Its owner opens and closes the invite; everyone else sees who is in. */
export function ShareScreen({ workspaceId }: { workspaceId: Id<'workspaces'> }) {
  const { palette, type } = useTheme();
  const status = useQuery(api.sharing.status, { workspaceId });
  const enable = useMutation(api.sharing.enable);
  const disable = useMutation(api.sharing.disable);
  const removeMember = useMutation(api.sharing.removeMember);
  const leave = useMutation(api.sharing.leave);
  const notice = useNotice();
  const { user } = useUser();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const run = async (work: () => Promise<unknown>, failed: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try { await work(); }
    catch (error) { notice(errorMessage(error, failed)); }
    finally { lock.current = false; setBusy(false); }
  };

  const header = <>
    <Stack.Screen options={{ title: 'Share' }} />
    <Stack.Header transparent={false} style={{ backgroundColor: palette.paper }} />
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
    </Stack.Toolbar>
  </>;

  if (status === undefined) return <View style={{ flex: 1, backgroundColor: palette.paper }}>{header}<ActivityIndicator color={palette.muted} style={{ flex: 1 }} /></View>;

  const owner = status.role === 'owner';
  const code = status.code;
  const invite = code ? `Join “${status.title}” on Foldspace.\n\nOpen foldspace://join?code=${spaced(code)}\nor choose “Join a shared space” and enter ${spaced(code)}` : '';
  const copy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(spaced(code));
    if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notice('Code copied');
  };
  const stop = () => Alert.alert('Stop sharing?', status.members.length
    ? 'Everyone who joined loses access, and the code stops working.'
    : 'The code stops working.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Stop', style: 'destructive', onPress: () => { void run(() => disable({ workspaceId }), 'Could not stop sharing. Try again.'); } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {header}
      <ScrollView contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ width: '100%', maxWidth: 560, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl }}>
        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" numberOfLines={2} style={type.title}>{status.title}</Text>
          <Text style={type.secondary}>
            {owner
              ? code ? 'Anyone signed in to Foldspace with this code can open and edit this space. Changes appear for everyone as they happen.'
                : 'Invite people to open and edit this space with you. Changes appear for everyone as they happen.'
              : `${status.ownerName ?? 'The owner'} shared this space with you. You can add to it and edit it.`}
          </Text>
        </View>

        {owner && !code && (
          <Button title={busy ? 'Creating…' : 'Create an invite'} busy={busy} testID="share-enable"
            onPress={() => { void run(() => enable({ workspaceId, name: displayName(user) }), 'Could not create an invite. Try again.'); }} />
        )}

        {owner && code && (
          <View style={{ gap: spacing.md }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Invite code ${spaced(code).split('').join(' ')}`} accessibilityHint="Copies the code" testID="share-code"
              onPress={() => { void copy(); }}
              style={({ pressed }) => ({ alignItems: 'center', gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: pressed ? palette.pressed : palette.surface })}>
              <Text selectable style={{ fontSize: 24, fontWeight: '600', letterSpacing: 1.5, color: palette.ink, fontVariant: ['tabular-nums'] }}>{spaced(code)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }} size={12} tintColor={palette.muted} style={{ width: 14, height: 14 }} />
                <Text style={type.caption}>Tap to copy</Text>
              </View>
            </Pressable>
            <Button title="Send invite" testID="share-send" onPress={() => { void Share.share({ message: invite }).catch(() => {}); }} />
          </View>
        )}

        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" style={type.caption}>People</Text>
          <Person name={owner ? 'You' : status.ownerName ?? 'Owner'} detail="Owner" />
          {status.members.map(member => (
            <Person key={member.userId} name={member.isYou ? 'You' : member.name} detail="Can edit"
              onRemove={owner ? () => { void run(() => removeMember({ workspaceId, userId: member.userId }), 'Could not remove them. Try again.'); } : undefined} />
          ))}
          {owner && !status.members.length && <Text style={[type.secondary, { paddingVertical: spacing.sm }]}>{code ? 'No one has joined yet.' : 'Only you.'}</Text>}
        </View>

        {owner && code && <Button variant="destructive" title="Stop sharing" disabled={busy} onPress={stop} testID="share-disable" />}
        {!owner && (
          <Button variant="destructive" title="Leave space" disabled={busy} testID="share-leave"
            onPress={() => { void run(async () => { await leave({ workspaceId }); router.dismissTo('/'); }, 'Could not leave this space. Try again.'); }} />
        )}
      </ScrollView>
    </View>
  );
}

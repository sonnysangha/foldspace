import { useUser } from '@clerk/expo';
import { useMutation } from 'convex/react';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useRef, useState } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import { Button } from '@/components/button';
import { useNotice } from '@/components/notice-provider';
import { radius, spacing, useTheme } from '@/theme';
import { displayName } from '@/utils/display-name';
import { errorMessage } from '@/utils/error-message';

/** Enter a code someone sent you, or arrive here from an invite link with it filled in. */
export function JoinScreen({ initialCode }: { initialCode: string }) {
  const { dark, palette, type } = useTheme();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const join = useMutation(api.sharing.join);
  const notice = useNotice();
  const { user } = useUser();
  const ready = code.replace(/[^A-Za-z0-9]/g, '').length === 12;

  const submit = async () => {
    if (lock.current || !ready) return;
    lock.current = true;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    try {
      const space = await join({ code, name: displayName(user) });
      if (!space) { setError('No space is shared with that code. Check it, or ask for a new one.'); return; }
      router.dismiss();
      router.push({ pathname: '/workspace/[id]', params: { id: space._id } });
      notice(`Joined “${space.title}”`);
    } catch (problem) {
      setError(errorMessage(problem, 'Could not join. Check your connection and try again.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <Stack.Screen options={{ title: 'Join a space' }} />
      <Stack.Header transparent={false} style={{ backgroundColor: palette.paper }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button disabled={busy} onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg }}>
        <Text style={type.secondary}>Enter the twelve-character code from your invite. You will be able to open and edit the space.</Text>
        <TextInput
          value={code}
          onChangeText={value => { setCode(value.toUpperCase()); if (error) setError(''); }}
          autoFocus={!initialCode}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          keyboardAppearance={dark ? 'dark' : 'light'}
          placeholder="ABCD-EFGH-JKMN"
          placeholderTextColor={palette.faint}
          accessibilityLabel="Invite code"
          testID="join-code"
          maxLength={16}
          editable={!busy}
          returnKeyType="join"
          onSubmitEditing={() => { void submit(); }}
          style={{
            padding: 14, fontSize: 22, fontWeight: '600', letterSpacing: 1.5, textAlign: 'center', color: palette.ink,
            backgroundColor: palette.surface, borderRadius: radius.md, borderCurve: 'continuous',
            borderWidth: 1, borderColor: error ? palette.danger : palette.surface,
          }}
        />
        {!!error && <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 14, lineHeight: 20 }}>{error}</Text>}
        <Button title={busy ? 'Joining…' : 'Join'} busy={busy} disabled={!ready} onPress={() => { void submit(); }} testID="join-submit" />
      </View>
    </View>
  );
}

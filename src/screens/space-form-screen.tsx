import { Column, Host, RNHostView, ScrollView, TextInput, type TextInputRef } from '@expo/ui';
import { useMutation } from 'convex/react';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useRef, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { spaceTemplates, type SpaceTemplateId, type TemplateCard } from '../../shared/space-templates';
import { ColorSwatches } from '@/components/native/color-swatches';
import { useBoundText } from '@/components/native/use-bound-text';
import { useNotice } from '@/components/notice-provider';
import { radius, spaceColors, spacing, useTheme } from '@/theme';
import { errorMessage } from '@/utils/error-message';
import { unionBounds } from '@/utils/canvas-math';

type Space = { _id: Id<'workspaces'>; title: string; color: string };

const colorChoices = spaceColors.map((value, index) => ({
  value,
  label: ['Black', 'Red', 'Green', 'Blue', 'Violet'][index],
}));

/** A neutral thumbnail of a template's layout. Shape only, so the choice reads at a glance. */
export function TemplatePreview({ cards }: { cards: TemplateCard[] }) {
  const { palette } = useTheme();
  const bounds = unionBounds(cards);
  const scale = bounds ? Math.min(88 / bounds.width, 44 / bounds.height) : 1;

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none"
      style={{ height: 56, alignItems: 'center', justifyContent: 'center' }}>
      {bounds && (
        <View style={{ width: bounds.width * scale, height: bounds.height * scale }}>
          {cards.map(card => (
            <View key={card.title} style={{
              position: 'absolute', top: (card.y - bounds.y) * scale, left: (card.x - bounds.x) * scale,
              width: card.width * scale, height: card.height * scale, borderRadius: 3, backgroundColor: palette.faint,
            }} />
          ))}
        </View>
      )}
    </View>
  );
}

export function SpaceFormScreen({ space }: { space?: Space }) {
  const { dark, palette, type } = useTheme();
  const [name, setName] = useState(space?.title ?? '');
  const field = useBoundText(name, setName);
  const [color, setColor] = useState(space?.color ?? spaceColors[0]);
  const [template, setTemplate] = useState<SpaceTemplateId>('blank');
  const [width, setWidth] = useState(360);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const lock = useRef(false);
  const input = useRef<TextInputRef>(null);
  const create = useMutation(api.workspaces.create);
  const update = useMutation(api.workspaces.update);
  const notice = useNotice();
  const contentWidth = Math.max(1, Math.min(560, width - spacing.lg * 2));
  const selectedTemplate = spaceTemplates.find(item => item.id === template);
  const customColor = space?.color && !spaceColors.includes(space.color) ? space.color : undefined;
  const colors = customColor ? [...colorChoices, { value: customColor, label: 'Original color' }] : colorChoices;

  const submit = async () => {
    if (lock.current) return;
    const title = field.state.get().trim();
    if (!title) {
      setNameError(true);
      input.current?.focus();
      return;
    }

    lock.current = true;
    setBusy(true);
    setSaveError('');
    input.current?.blur();
    Keyboard.dismiss();

    try {
      if (space) {
        await update({ id: space._id, title, color });
        router.back();
        notice('Saved');
      } else {
        const result = await create({ title, color, template });
        router.dismiss();
        router.push({ pathname: '/workspace/[id]', params: { id: result._id } });
      }
    } catch (error) {
      setSaveError(errorMessage(error, 'Could not save. Check your connection and try again.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Stack.Screen options={{ title: space ? 'Edit space' : 'New space' }} />
      <Stack.Header transparent={false} style={{ backgroundColor: palette.paper }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button disabled={busy} onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
      </Stack.Toolbar>
      {/* The primary action lives in the header so the keyboard can never cover it. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="prominent" tintColor={palette.ink} disabled={busy} onPress={() => { void submit(); }}>{busy ? 'Saving…' : space ? 'Save' : 'Create'}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} seedColor={palette.ink} colorScheme={dark ? 'dark' : 'light'}>
        <ScrollView showsIndicators={false}>
          <Column spacing={spacing.xl} style={{ width, paddingHorizontal: (width - contentWidth) / 2, paddingTop: spacing.lg, paddingBottom: spacing.xxl }}>
            <Column spacing={spacing.sm} alignment="start">
              <TextInput
                ref={input}
                value={field.state}
                onChangeText={value => {
                  field.onChangeText(value);
                  if (nameError) setNameError(false);
                }}
                autoFocus={!space}
                placeholder="Name"
                placeholderTextColor={palette.faint}
                accessibilityLabel="Space name"
                testID="space-name"
                maxLength={160}
                editable={!busy}
                onSubmitEditing={() => { void submit(); }}
                returnKeyType="done"
                style={{
                  width: contentWidth,
                  padding: 14,
                  backgroundColor: palette.surface,
                  borderRadius: radius.md,
                  borderColor: nameError ? palette.danger : palette.surface,
                  borderWidth: 1,
                }}
                textStyle={{ fontSize: 17, color: palette.ink }}
              />
              {nameError && (
                <RNHostView matchContents>
                  <Text accessibilityRole="alert" style={{ width: contentWidth, color: palette.danger, fontSize: 14 }}>Enter a name to continue.</Text>
                </RNHostView>
              )}
            </Column>
            <RNHostView matchContents>
              <View style={{ width: contentWidth, gap: spacing.xl }}>
                <View testID="space-color">
                  <ColorSwatches
                    label="Color"
                    options={colors}
                    value={color}
                    onChange={value => {
                      if (busy) return;
                      input.current?.blur();
                      setColor(value);
                    }}
                  />
                </View>

                {!space && (
                  <View style={{ gap: spacing.sm }}>
                    <Text style={type.caption}>Start with</Text>
                    <View testID="space-template" accessibilityRole="radiogroup" accessibilityLabel="Start with" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {spaceTemplates.map(item => {
                        const selected = item.id === template;
                        return (
                          <Pressable
                            key={item.id}
                            accessibilityRole="radio"
                            accessibilityLabel={item.title}
                            accessibilityHint={item.description}
                            accessibilityState={{ checked: selected, selected, disabled: busy }}
                            testID={`space-template-${item.id}`}
                            disabled={busy}
                            onPress={() => { input.current?.blur(); setTemplate(item.id); }}
                            style={({ pressed }) => ({
                              width: (contentWidth - spacing.sm) / 2,
                              padding: spacing.md,
                              borderRadius: radius.md,
                              borderCurve: 'continuous',
                              backgroundColor: palette.surface,
                              borderColor: selected ? palette.ink : palette.surface,
                              borderWidth: 1.5,
                              gap: spacing.xs,
                              opacity: pressed ? 0.7 : 1,
                            })}
                          >
                            <TemplatePreview cards={item.cards} />
                            <Text style={{ fontSize: 15, fontWeight: selected ? '600' : '400', color: palette.ink, textAlign: 'center' }}>{item.title}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text accessibilityLiveRegion="polite" style={type.caption}>{selectedTemplate?.description}</Text>
                  </View>
                )}

                {!!saveError && <Text accessibilityRole="alert" selectable style={{ color: palette.danger, fontSize: 14, lineHeight: 20 }}>{saveError}</Text>}
              </View>
            </RNHostView>
          </Column>
        </ScrollView>
      </Host>
    </View>
  );
}

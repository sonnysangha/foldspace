import { Column, Host, RNHostView, ScrollView, TextInput, type TextInputRef } from '@expo/ui';
import { Image } from 'expo-image';
import { useImperativeHandle, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { cardInk, lightPalette, radius, spacing } from '@/theme';
import { paperColor } from '@/utils/paper-color';
import type { CardEditorProps } from './native-types';
import { useBoundText } from './use-bound-text';

/**
 * Editing a card is writing on it. The pane is the card's own paper, with the title and
 * description typed straight onto it. Colour, size and delete float at the bottom of the pane.
 */
export function CardEditor({
  kind, url, title, body, color, onTitleChange, onBodyChange, onOpenCanvas, onOpenLink, renderExtra, editorRef, imageUrl, autoFocus = false,
}: CardEditorProps) {
  // Numeric native widths avoid zero-width percentage resolution in a scrolling host.
  // Measure this pane, not the screen, so the same fields survive Duo pose changes.
  const [width, setWidth] = useState(360);
  const { fontScale } = useWindowDimensions();
  const titleRef = useRef<TextInputRef>(null);
  const bodyRef = useRef<TextInputRef>(null);
  useImperativeHandle(editorRef, () => ({ blur() { titleRef.current?.blur(); bodyRef.current?.blur(); } }), []);
  const contentWidth = Math.max(1, width - spacing.xl * 2);
  const titleField = useBoundText(title, onTitleChange);
  const bodyField = useBoundText(body, onBodyChange);
  const paper = paperColor(color);

  return <Host style={[styles.fill, { backgroundColor: paper }]} seedColor={cardInk.ink} colorScheme="light" onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <ScrollView showsIndicators={false}>
      <Column spacing={spacing.md} style={{ width, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 160 }}>
        {!!imageUrl && <RNHostView matchContents><Image source={{ uri: imageUrl }} contentFit="contain" accessibilityLabel={title || 'Card image'} style={{ width: contentWidth, height: 210, borderRadius: radius.md, backgroundColor: lightPalette.surface }} /></RNHostView>}
        <TextInput ref={titleRef} autoFocus={autoFocus} selectTextOnFocus={autoFocus} value={titleField.state} onChangeText={titleField.onChangeText}
          placeholder="Title" placeholderTextColor={cardInk.faint} accessibilityLabel="Card title" testID="card-title"
          maxLength={160} multiline autoCapitalize="sentences"
          style={{ width: contentWidth }} textStyle={{ fontSize: 26 * fontScale, fontWeight: '700', lineHeight: 32 * fontScale, color: cardInk.ink }} />
        {renderExtra && <RNHostView matchContents><View style={{ width: contentWidth }}>{renderExtra(contentWidth)}</View></RNHostView>}
        {kind !== 'canvas' && kind !== 'checklist' && <TextInput ref={bodyRef} value={bodyField.state} onChangeText={bodyField.onChangeText}
          placeholder={kind === 'link' ? 'Why this link matters' : kind === 'note' ? 'Write something' : 'Add a note'} placeholderTextColor={cardInk.faint} accessibilityLabel="Card description" testID="card-body"
          maxLength={8000} multiline numberOfLines={kind === 'note' ? 14 : 4} autoCapitalize="sentences"
          style={{ width: contentWidth }} textStyle={{ fontSize: 18 * fontScale, lineHeight: 27 * fontScale, color: cardInk.ink }} />}
        {(onOpenCanvas || onOpenLink) && <RNHostView matchContents>
          <View style={{ width: contentWidth }}>
            {onOpenCanvas && <Pressable accessibilityRole="button" accessibilityLabel="Open space" accessibilityHint="Steps into this space's canvas" onPress={onOpenCanvas} testID="open-child-canvas"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text style={styles.actionLabel}>Open space</Text>
              <SymbolView name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full', web: 'open_in_full' }} size={14} tintColor={cardInk.onInk} />
            </Pressable>}
            {onOpenLink && <Pressable accessibilityRole="link" accessibilityLabel="Open link" accessibilityHint={url} onPress={onOpenLink} testID="open-link"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
              <Text style={styles.actionLabel}>Open link</Text>
              <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={14} tintColor={cardInk.onInk} />
            </Pressable>}
            {!!url && <Text numberOfLines={2} selectable style={{ fontSize: 13, color: cardInk.muted, marginTop: spacing.sm }}>{url}</Text>}
          </View>
        </RNHostView>}
      </Column>
    </ScrollView>
  </Host>;
}

export default CardEditor;

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0, minHeight: 0 },
  action: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 22, backgroundColor: cardInk.ink, marginTop: spacing.sm },
  actionLabel: { fontSize: 16, fontWeight: '600', color: cardInk.onInk },
  pressed: { opacity: 0.6 },
});

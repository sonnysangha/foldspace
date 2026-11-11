import { SymbolView } from 'expo-symbols';
import { useRef, type ComponentRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { cardInk, spacing } from '@/theme';
import { parseChecklist, serializeChecklist, type ChecklistItem } from '@/utils/checklist';

/** The items of a checklist card: tap a box to tick it, type to rename, Return to add the next one. */
export function ChecklistEditor({ body, onChange, width }: { body: string; onChange: (body: string) => void; width: number }) {
  const items = parseChecklist(body);
  const inputs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);
  const commit = (next: ChecklistItem[]) => onChange(serializeChecklist(next));
  const add = (after: number) => {
    commit([...items.slice(0, after + 1), { done: false, text: '' }, ...items.slice(after + 1)]);
    setTimeout(() => inputs.current[after + 1]?.focus(), 60);
  };

  return <View style={{ width, gap: spacing.xs }} testID="checklist-items">
    {items.map((item, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: item.done }} accessibilityLabel={item.text || 'Item'} hitSlop={8}
        onPress={() => commit(items.map((value, i) => i === index ? { ...value, done: !value.done } : value))}
        style={{ width: 28, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 22, height: 22, borderRadius: 7, borderCurve: 'continuous', borderWidth: 1.5, borderColor: cardInk.ink, backgroundColor: item.done ? cardInk.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {item.done && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={12} weight="bold" tintColor={cardInk.onInk} />}
        </View>
      </Pressable>
      <TextInput ref={node => { inputs.current[index] = node; }} value={item.text} placeholder="To do" placeholderTextColor={cardInk.faint}
        onChangeText={text => commit(items.map((value, i) => i === index ? { ...value, text } : value))}
        onSubmitEditing={() => add(index)} submitBehavior="submit" returnKeyType="next"
        onKeyPress={event => {
          // Backspace on an empty item removes it.
          if (event.nativeEvent.key === 'Backspace' && !item.text && items.length > 1) {
            commit(items.filter((_, i) => i !== index));
            setTimeout(() => inputs.current[Math.max(0, index - 1)]?.focus(), 60);
          }
        }}
        style={{ flex: 1, minHeight: 44, fontSize: 18, color: item.done ? cardInk.muted : cardInk.ink, textDecorationLine: item.done ? 'line-through' : 'none' }} />
    </View>)}
    <Pressable accessibilityRole="button" accessibilityLabel="Add item" testID="add-checklist-item" onPress={() => add(items.length - 1)}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, opacity: pressed ? 0.5 : 1 })}>
      <View style={{ width: 28, alignItems: 'center' }}><SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={15} tintColor={cardInk.muted} /></View>
      <Text style={{ fontSize: 18, color: cardInk.muted }}>Add item</Text>
    </Pressable>
  </View>;
}

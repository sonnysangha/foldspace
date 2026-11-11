import { StyleSheet, View } from 'react-native';

import type { DuoLayoutProps } from './native-types';

export function DuoLayout({ primary, secondary, wide, showSecondary }: DuoLayoutProps) {
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

export default DuoLayout;

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0, minHeight: 0 },
  row: { flex: 1, flexDirection: 'row', minWidth: 0, minHeight: 0 },
  primary: { flex: 1.6, minWidth: 0, minHeight: 0 },
  secondary: { flex: 1, minWidth: 0, minHeight: 0 },
});

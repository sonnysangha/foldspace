import { UserProfile } from '@clerk/expo/web';
import { View } from 'react-native';

import { useTheme } from '@/theme';

export function ManageAccount({ onBack: _onBack }: { onBack: () => void }) {
  const { palette } = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', padding: 24, backgroundColor: palette.paper }}><UserProfile routing="hash" /></View>;
}

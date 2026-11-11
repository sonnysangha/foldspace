import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function ManageAccount({ onBack: _onBack }: { onBack: () => void }) {
  const { palette, type } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: palette.paper }}>
      <Text style={[type.secondary, { textAlign: 'center' }]}>Manage your account in the Foldspace iPhone app.</Text>
    </View>
  );
}

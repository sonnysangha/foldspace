import { Stack } from 'expo-router/stack';
import { useTheme } from '@/theme';
export default function AccountLayout() {
  const { palette } = useTheme();
  return <Stack screenOptions={{ title: 'You', headerTintColor: palette.ink, contentStyle: { backgroundColor: palette.paper }, headerLargeTitleEnabled: true, headerShadowVisible: false }} />;
}

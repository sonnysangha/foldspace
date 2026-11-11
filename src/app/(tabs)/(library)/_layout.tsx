import { Stack } from 'expo-router/stack';
import { useTheme } from '@/theme';
export default function LibraryLayout() {
  const { palette } = useTheme();
  return <Stack screenOptions={{ headerTintColor: palette.ink, contentStyle: { backgroundColor: palette.paper }, headerLargeTitleEnabled: true, headerShadowVisible: false }} />;
}

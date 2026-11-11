import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/theme';

export const unstable_settings = { anchor: '(library)' };

export default function TabsLayout() {
  const { palette } = useTheme();
  return <NativeTabs tintColor={palette.ink} backgroundColor={palette.paper}>
    <NativeTabs.Trigger name="(library)">
      <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="dashboard" />
      <NativeTabs.Trigger.Label>Spaces</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="(account)">
      <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  </NativeTabs>;
}

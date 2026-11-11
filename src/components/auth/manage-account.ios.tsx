import { useAuth } from '@clerk/expo';
import { UserProfileView } from '@clerk/expo-native-components';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadingView } from '@/components/loading-view';
import { useTheme } from '@/theme';

/** Clerk's native profile. Place in a route with its header hidden; Clerk owns its chrome. */
export function ManageAccount({ onBack }: { onBack: () => void }) {
  const { palette } = useTheme();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  if (!isLoaded || !isSignedIn) return <LoadingView label="Loading your account…" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper }} edges={['left', 'right', 'bottom']}>
      <UserProfileView isDismissible={false} onHostBack={onBack} style={{ flex: 1, backgroundColor: palette.paper }} />
    </SafeAreaView>
  );
}

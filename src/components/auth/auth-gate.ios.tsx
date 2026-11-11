import { useAuth, useSession } from '@clerk/expo';
import { AuthView, UserButton } from '@clerk/expo-native-components';
import { useConvexAuth } from 'convex/react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthProgress, AuthWelcome } from './auth-welcome';

/** Private data is mounted only after Convex has verified the Clerk session. */
export function AuthGate({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { session } = useSession();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const sessionIsActive = isLoaded && isSignedIn && session?.status === 'active';

  if (sessionIsActive && isAuthenticated && !isLoading) return <>{children}</>;
  if (!isLoaded) return <AuthProgress message="Getting your space ready…" />;

  // Keep the native flow mounted through pending session tasks. A signed-in
  // session can still require a task, so isSignedIn alone must not close it.
  return (
    <View style={styles.fill}>
      <AuthWelcome>
        <AuthView isDismissible={false} mode="signInOrUp" />
      </AuthWelcome>
      {sessionIsActive && (
        <View style={styles.connectionOverlay}>
          <AuthProgress account={<View style={styles.avatar}><UserButton /></View>} />
        </View>
      )}
    </View>
  );
}

export default AuthGate;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  connectionOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  avatar: { width: 40, height: 40 },
});

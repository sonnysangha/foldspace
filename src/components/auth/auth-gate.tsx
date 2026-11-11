import { useAuth } from '@clerk/expo';
import { useConvexAuth } from 'convex/react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthProgress, AuthWelcome } from './auth-welcome';

export function AuthGate({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoaded && isSignedIn && isAuthenticated && !isLoading) return <>{children}</>;
  if (!isLoaded || isSignedIn) return <AuthProgress />;
  return (
    <AuthWelcome>
      <View style={styles.message}>
        <Text style={styles.title}>Open your space on iPhone</Text>
        <Text style={styles.body}>Use the Foldspace iOS development build to sign in and explore your private canvases.</Text>
      </View>
    </AuthWelcome>
  );
}

export default AuthGate;

const styles = StyleSheet.create({
  message: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  title: { fontSize: 24, fontWeight: '600', color: '#141414', letterSpacing: -0.7 },
  body: { fontSize: 16, lineHeight: 24, color: '#6E6E6A' },
});

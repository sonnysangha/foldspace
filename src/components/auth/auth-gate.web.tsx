import { useAuth } from '@clerk/expo';
import { SignIn } from '@clerk/expo/web';
import { useConvexAuth } from 'convex/react';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthProgress, AuthWelcome } from './auth-welcome';

export function AuthGate({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoaded && isSignedIn && isAuthenticated && !isLoading) return <>{children}</>;
  if (!isLoaded || isSignedIn) return <AuthProgress />;
  return <AuthWelcome><View style={styles.form}><SignIn routing="hash" /></View></AuthWelcome>;
}

export default AuthGate;

const styles = StyleSheet.create({ form: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 } });

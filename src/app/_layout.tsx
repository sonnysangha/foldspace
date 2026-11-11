import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthGate } from '@/components/auth/auth-gate';
import { CanvasHistoryProvider } from '@/components/canvas-history-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { NoticeProvider } from '@/components/notice-provider';
import { useTheme } from '@/theme';
import { loadAppearance } from '@/utils/appearance';

void loadAppearance();

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const convex = convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null;

export default function RootLayout() {
  const { palette } = useTheme();
  if (!convex || !publishableKey) {
    throw new Error('Foldspace needs its Clerk and Convex project configuration. See README.md.');
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
            <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
              <ErrorBoundary>
                <NoticeProvider>
                  <AuthGate>
                    <CanvasHistoryProvider>
                    <Stack screenOptions={{
                      contentStyle: { backgroundColor: palette.paper },
                      headerTintColor: palette.ink,
                      headerBackButtonDisplayMode: 'minimal',
                      headerShadowVisible: false,
                    }}>
                      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Spaces' }} />
                      <Stack.Screen name="workspace/[id]" options={{ title: 'Canvas', headerShown: false }} />
                      <Stack.Screen name="canvas/[id]" options={{ title: 'Canvas', headerShown: false }} />
                      <Stack.Screen name="manage-account" options={{ title: 'Account', headerShown: false }} />
                      <Stack.Screen name="join" options={{ title: 'Join a space', presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true }} />
                      <Stack.Screen name="share/[id]" options={{ title: 'Share', presentation: 'formSheet', sheetAllowedDetents: [1], sheetGrabberVisible: true }} />
                      <Stack.Screen name="search/[id]" options={{ title: 'Find an idea' }} />
                      <Stack.Screen name="edit-workspace/[id]" options={{ title: 'Edit space', presentation: 'formSheet', sheetAllowedDetents: [0.8, 1], sheetGrabberVisible: true }} />
                      <Stack.Screen name="new-workspace" options={{ title: 'New space', presentation: 'formSheet', sheetAllowedDetents: [0.8, 1], sheetInitialDetentIndex: 1, sheetGrabberVisible: true }} />
                    </Stack>
                    </CanvasHistoryProvider>
                  </AuthGate>
                  <StatusBar style="auto" />
                </NoticeProvider>
              </ErrorBoundary>
            </ConvexProviderWithClerk>
          </ClerkProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { spacing, useTheme } from '@/theme';

export function MissingDocument() {
  const { palette, type } = useTheme();
  return <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg, backgroundColor: palette.paper }}>
    <Stack.Screen options={{ title: '' }} />
    <Text accessibilityRole="header" style={type.title}>This canvas isn’t available</Text>
    <Text style={type.secondary}>It may have been deleted, or it belongs to a different account.</Text>
    <Button title="Back to your spaces" onPress={() => router.dismissTo('/')} />
  </View>;
}
export class DocumentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Foldspace document error', error, info.componentStack); }
  render() { return this.state.failed ? <MissingDocument /> : this.props.children; }
}

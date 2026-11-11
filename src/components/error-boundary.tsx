import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { spacing, useTheme } from '@/theme';

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { palette, type } = useTheme();
  return <View style={{ flex: 1, backgroundColor: palette.paper, justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg }}>
    <Text accessibilityRole="header" style={type.title}>Something went wrong</Text>
    <Text selectable style={type.secondary}>Your work is saved. Check your connection, then try again.</Text>
    <Button title="Try again" onPress={onRetry} />
  </View>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Foldspace render error', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <Fallback onRetry={() => this.setState({ error: null })} />;
  }
}

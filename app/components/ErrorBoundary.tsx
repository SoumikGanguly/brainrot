// Create ErrorBoundary.tsx
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // Log to analytics service
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <View className="flex-1 justify-center items-center p-4">
          <Text className="text-lg font-bold text-danger mb-4">
            Something went wrong
          </Text>
          <Text className="text-sm text-muted mb-4">
            {this.state.error?.message}
          </Text>
          <TouchableOpacity
            onPress={this.handleReset}
            className="bg-accent px-6 py-3 rounded-lg"
          >
            <Text className="text-white font-medium">Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
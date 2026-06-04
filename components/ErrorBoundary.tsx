import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { TelemetryService } from '../services/TelemetryService';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    TelemetryService.captureException(error, {
      componentStack: errorInfo.componentStack || 'unknown',
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <View className="flex-1 items-center justify-center p-4">
          <Text className="mb-4 text-lg font-bold text-danger">
            Something went wrong
          </Text>
          <Text className="mb-4 text-sm text-muted">
            {this.state.error?.message}
          </Text>
          <TouchableOpacity
            onPress={this.handleReset}
            className="rounded-lg bg-accent px-6 py-3"
          >
            <Text className="font-medium text-white">Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

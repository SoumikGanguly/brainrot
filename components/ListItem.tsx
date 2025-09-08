import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface ListItemProps {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
}

export function ListItem({ title, subtitle, rightElement, onPress }: ListItemProps) {
  const Component = onPress ? TouchableOpacity : View;

  return (
    <Component
      className="flex-row items-center justify-between py-sm border-b border-gray-100 last:border-b-0"
      onPress={onPress}
    >
      <View className="flex-1 mr-sm">
        <Text className="text-base font-medium text-text">{title}</Text>
        {subtitle && (
          <Text className="text-sm text-muted mt-xs">{subtitle}</Text>
        )}
      </View>
      {rightElement}
    </Component>
  );
}
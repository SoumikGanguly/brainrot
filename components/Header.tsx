import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

interface HeaderProps {
  title: string;
  showInfo?: boolean;
  onInfoPress?: () => void;
}

export function Header({ title, showInfo, onInfoPress }: HeaderProps) {
  return (
    <View className="flex-row items-center justify-between px-md py-sm">
      <Text className="font-heading-bold text-section text-text">{title}</Text>
      {showInfo && (
        <TouchableOpacity onPress={onInfoPress}>
          <Ionicons name="information-circle-outline" size={24} color="#64748B" />
        </TouchableOpacity>
      )}
    </View>
  );
}

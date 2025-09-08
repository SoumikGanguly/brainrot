import React from 'react';
import { Text, TouchableOpacity, TouchableOpacityProps } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
}

export function PrimaryButton({ title, className, ...props }: ButtonProps) {
  return (
    <TouchableOpacity
      className={`bg-accent py-sm px-md rounded-lg items-center justify-center ${className || ''}`}
      {...props}
    >
      <Text className="text-base font-semibold text-white">{title}</Text>
    </TouchableOpacity>
  );
}

export function SecondaryButton({ title, className, ...props }: ButtonProps) {
  return (
    <TouchableOpacity
      className={`bg-surface border border-accent py-sm px-md rounded-lg items-center justify-center ${className || ''}`}
      {...props}
    >
      <Text className="text-base font-semibold text-accent">{title}</Text>
    </TouchableOpacity>
  );
}
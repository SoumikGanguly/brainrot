import React from 'react';
import { Text, TouchableOpacity, TouchableOpacityProps } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
}

export function PrimaryButton({ title, className, disabled, ...props }: ButtonProps) {
  return (
    <TouchableOpacity
      className={`py-sm px-md rounded-lg items-center justify-center ${disabled ? 'bg-gray-300' : 'bg-accent'} ${className || ''}`}
      disabled={disabled}
      {...props}
    >
      <Text className={`text-base font-semibold ${disabled ? 'text-gray-500' : 'text-white'}`}>{title}</Text>
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
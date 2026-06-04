import React from 'react';
import { View, ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <View 
      className={`bg-card rounded-lg p-md shadow-sm border border-slate-200 ${className || ''}`}
      {...props}
    >
      {children}
    </View>
  );
}

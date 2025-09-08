import React from 'react';
import { Animated, TouchableOpacity } from 'react-native';

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
}

export function Toggle({ value, onValueChange }: ToggleProps) {
  const animatedValue = React.useRef(new Animated.Value(value ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const toggleSwitch = () => {
    onValueChange(!value);
  };

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 22],
  });

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['#E5E7EB', '#4F46E5'],
  });

  return (
    <TouchableOpacity onPress={toggleSwitch}>
      <Animated.View
        style={{ backgroundColor }}
        className="w-12 h-6 rounded-full justify-center"
      >
        <Animated.View
          style={{ transform: [{ translateX }] }}
          className="w-5 h-5 bg-white rounded-full shadow-sm"
        />
      </Animated.View>
    </TouchableOpacity>
  );
}
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

interface SliderProps {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step?: number;
  onValueChange: (value: number) => void;
}

export function Slider({ value, minimumValue, maximumValue, step = 1, onValueChange }: SliderProps) {
  const sliderWidth = 280;
  const safeRange = Math.max(maximumValue - minimumValue, 1);
  const translateX = useSharedValue(((value - minimumValue) / safeRange) * sliderWidth);
  const startX = useSharedValue(0);

  useEffect(() => {
    translateX.value = ((value - minimumValue) / safeRange) * sliderWidth;
  }, [maximumValue, minimumValue, safeRange, sliderWidth, translateX, value]);

  const gesture = Gesture.Pan()
    .onBegin(() => {
      startX.value = translateX.value;
    })
    .onUpdate((event) => {
      const newTranslateX = Math.max(0, Math.min(sliderWidth, startX.value + event.translationX));
      translateX.value = newTranslateX;
    })
    .onEnd(() => {
      const percentage = translateX.value / sliderWidth;
      const newValue = minimumValue + percentage * (maximumValue - minimumValue);
      const steppedValue = Math.round(newValue / step) * step;
      runOnJS(onValueChange)(Math.max(minimumValue, Math.min(maximumValue, steppedValue)));
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const trackStyle = useAnimatedStyle(() => ({
    width: translateX.value,
  }));

  return (
    <View className="h-8 justify-center">
      <View className="h-1 bg-gray-200 rounded-full mx-2">
        <Animated.View style={trackStyle} className="h-full bg-accent rounded-full" />
      </View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={thumbStyle}
          className="absolute w-6 h-6 bg-white border-2 border-accent rounded-full shadow-md"
        />
      </GestureDetector>
    </View>
  );
}

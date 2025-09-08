import React from 'react';
import { PanGestureHandler, PanGestureHandlerGestureEvent, View } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedGestureHandler,
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
  const translateX = useSharedValue((value - minimumValue) / (maximumValue - minimumValue) * 280);
  const sliderWidth = 280;

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onStart: (_, context: any) => {
      context.startX = translateX.value;
    },
    onActive: (event, context) => {
      const newTranslateX = Math.max(0, Math.min(sliderWidth, context.startX + event.translationX));
      translateX.value = newTranslateX;
    },
    onEnd: () => {
      const percentage = translateX.value / sliderWidth;
      const newValue = minimumValue + percentage * (maximumValue - minimumValue);
      const steppedValue = Math.round(newValue / step) * step;
      runOnJS(onValueChange)(Math.max(minimumValue, Math.min(maximumValue, steppedValue)));
    },
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
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View
          style={thumbStyle}
          className="absolute w-6 h-6 bg-white border-2 border-accent rounded-full shadow-md"
        />
      </PanGestureHandler>
    </View>
  );
}
import { useEffect, useRef } from "react";
import {
	Animated,
	type StyleProp,
	type ViewStyle,
} from "react-native";

type SkeletonBlockProps = {
	className?: string;
	style?: StyleProp<ViewStyle>;
};

export default function SkeletonBlock({
	className,
	style,
}: SkeletonBlockProps) {
	const opacity = useRef(new Animated.Value(0.55)).current;

	useEffect(() => {
		const animation = Animated.loop(
			Animated.sequence([
				Animated.timing(opacity, {
					toValue: 0.95,
					duration: 850,
					useNativeDriver: true,
				}),
				Animated.timing(opacity, {
					toValue: 0.55,
					duration: 850,
					useNativeDriver: true,
				}),
			]),
		);
		animation.start();
		return () => animation.stop();
	}, [opacity]);

	return (
		<Animated.View
			className={`overflow-hidden rounded-2xl bg-[#E9E2F8] ${className || ""}`}
			style={[{ opacity }, style]}
		/>
	);
}

import { Ionicons } from "@expo/vector-icons";
import { Modal, Text, TouchableOpacity, View } from "react-native";

export default function PermissionCoachBottomSheet({
	visible,
	title,
	body,
	helperText,
	primaryLabel,
	secondaryLabel,
	onPrimary,
	onSecondary,
	onClose,
	tone = "accent",
}: {
	visible: boolean;
	title: string;
	body: string;
	helperText: string;
	primaryLabel: string;
	secondaryLabel?: string;
	onPrimary: () => void;
	onSecondary?: () => void;
	onClose: () => void;
	tone?: "accent" | "warning";
}) {
	const accent = tone === "warning" ? "#D97706" : "#5D3DF0";

	return (
		<Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
			<View className="flex-1 justify-end bg-black/35 px-md pb-md">
				<TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />
				<View className="rounded-[28px] bg-white p-md">
					<View className="flex-row items-start justify-between">
						<View className="mr-3 h-11 w-11 items-center justify-center rounded-2xl bg-[#F5F1FF]">
							<Ionicons name="shield-checkmark-outline" size={22} color={accent} />
						</View>
						<TouchableOpacity onPress={onClose} className="p-1">
							<Ionicons name="close" size={20} color="#64748B" />
						</TouchableOpacity>
					</View>

					<Text className="mt-4 font-heading-bold text-section text-text">
						{title}
					</Text>
					<Text className="mt-3 font-body text-body text-slate-600">{body}</Text>
					<View className="mt-5 rounded-[24px] bg-[#FAF7FF] px-4 py-4">
						<Text className="font-body text-body text-slate-700">{helperText}</Text>
					</View>

					<TouchableOpacity
						onPress={onPrimary}
						className="mt-md items-center rounded-2xl px-4 py-4"
						style={{ backgroundColor: accent }}
					>
						<Text className="font-heading-semibold text-card-title text-white">
							{primaryLabel}
						</Text>
					</TouchableOpacity>

					{secondaryLabel && onSecondary ? (
						<TouchableOpacity
							onPress={onSecondary}
							className="mt-3 items-center rounded-2xl border border-slate-200 bg-white px-4 py-4"
						>
							<Text className="font-heading-semibold text-card-title text-slate-700">
								{secondaryLabel}
							</Text>
						</TouchableOpacity>
					) : null}
				</View>
			</View>
		</Modal>
	);
}

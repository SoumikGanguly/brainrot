import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View } from "react-native";

import { Card } from "./Card";
import type { PermissionNudge } from "@/services/PermissionHealthService";

export default function PermissionRecoveryCard({
	nudge,
	onFix,
	onRecheck,
	onDismiss,
}: {
	nudge: PermissionNudge;
	onFix: () => void;
	onRecheck: () => void;
	onDismiss?: () => void;
}) {
	const color = nudge.severity === "critical" ? "#DC2626" : nudge.severity === "warning" ? "#D97706" : "#2563EB";

	return (
		<Card className="mx-md mb-md border border-slate-200 bg-white">
			<View className="flex-row items-start">
				<View
					className="mr-3 h-10 w-10 items-center justify-center rounded-2xl"
					style={{ backgroundColor: `${color}18` }}
				>
					<Ionicons name="construct" size={20} color={color} />
				</View>
				<View className="flex-1">
					<View className="flex-row items-start justify-between">
						<Text className="flex-1 pr-3 font-heading-semibold text-card-title text-text">
							{nudge.title}
						</Text>
						{onDismiss ? (
							<TouchableOpacity onPress={onDismiss} className="p-1">
								<Ionicons name="close" size={18} color="#64748B" />
							</TouchableOpacity>
						) : null}
					</View>
					<Text className="mt-2 font-body text-secondary text-muted">
						{nudge.body}
					</Text>
					<Text className="mt-2 font-body text-secondary text-muted">
						{nudge.helperText}
					</Text>
					<View className="mt-4 flex-row">
						<TouchableOpacity
							onPress={onFix}
							className="mr-2 rounded-xl px-4 py-2"
							style={{ backgroundColor: color }}
						>
							<Text className="font-heading-semibold text-secondary text-white">
								{nudge.ctaLabel}
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={onRecheck}
							className="rounded-xl border border-slate-200 px-4 py-2"
						>
							<Text className="font-heading-semibold text-secondary text-muted">
								Recheck
							</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>
		</Card>
	);
}

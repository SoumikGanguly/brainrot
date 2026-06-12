import { Ionicons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View } from "react-native";

import type { InsightFeedbackVote } from "@/services/TelemetryEvents";

export default function InsightFeedbackRow({
  vote,
  onVoteChange,
  align = "center",
}: {
  vote: InsightFeedbackVote | null;
  onVoteChange: (nextVote: InsightFeedbackVote) => void;
  align?: "center" | "left";
}) {
  return (
    <View className={align === "left" ? "items-start" : "items-center"}>
      <Text className="font-body text-secondary text-muted">
        Was this insight helpful?
      </Text>
      <View className="mt-3 flex-row">
        {([
          { key: "up", icon: "thumbs-up-outline" },
          { key: "down", icon: "thumbs-down-outline" },
        ] as const).map((item) => {
          const selected = vote === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => onVoteChange(item.key)}
              className={`mx-2 rounded-full border px-4 py-3 ${
                selected ? "border-accent bg-violet-50" : "border-slate-200 bg-white"
              }`}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={selected ? "#5D3DF0" : "#64748B"}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

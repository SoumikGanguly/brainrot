import React, { useEffect, useRef } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Card } from './Card';

import type { InsightCard } from '@/services/InsightTypes';
import { buildInsightTelemetry, withDefinedProperties } from '@/services/TelemetryEvents';
import { TelemetryService } from '@/services/TelemetryService';

export default function ActionInsightCard({
  insight,
  label,
  surface,
  onPress,
}: {
  insight: InsightCard;
  label?: string;
  surface?: 'home' | 'replay';
  onPress: () => void;
}) {
  const trackedViewRef = useRef(false);

  useEffect(() => {
    if (trackedViewRef.current) {
      return;
    }

    trackedViewRef.current = true;
    TelemetryService.track('insight_card_viewed', withDefinedProperties(buildInsightTelemetry(insight)));
  }, [insight]);

  return (
    <Card className="mb-md border border-[#E7DFFD] bg-[#F7F3FF] px-5 py-5">
      <View>
        {label ? (
          <Text className="mb-3 font-heading-semibold text-secondary text-[#7C6AA6]">
            {label}
          </Text>
        ) : null}
        <Text className="font-heading-bold text-section leading-8 text-slate-900">
          {insight.headline}
        </Text>
        <Text className="mt-3 font-body text-body leading-6 text-slate-600">
          {insight.subtext}
        </Text>
        {insight.chips?.length ? (
          <View className="mt-4 flex-row flex-wrap">
            {insight.chips.map((chip) => (
              <View
                key={chip}
                className="mb-2 mr-2 rounded-full border border-[#DED3FF] bg-white px-3 py-2"
              >
                <Text className="font-body-semibold text-secondary text-[#5B4CF0]">
                  {chip}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <TouchableOpacity
          onPress={() => {
            const props = withDefinedProperties({
              ...buildInsightTelemetry(insight),
              cta_type: surface ? `${surface}:${insight.action.type}` : insight.action.type,
            });
            TelemetryService.track('insight_card_tapped', props);
            TelemetryService.track('insight_cta_clicked', props);
            onPress();
          }}
          className="mt-4 self-start rounded-2xl bg-accent px-4 py-3"
        >
          <Text className="font-heading-semibold text-card-title text-white">
            {insight.actionLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

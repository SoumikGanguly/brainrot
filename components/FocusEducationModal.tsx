import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Modal, Text, TouchableOpacity, View } from 'react-native';

const blockingPreview = require('../assets/onboarding_illustrations/blocking_screen_preview.png');
const BRAND_PURPLE = '#5D3DF0';

export type FocusEducationStep = 'accessibility' | 'oem';

export default function FocusEducationModal({
  visible,
  step,
  accessibilityGranted,
  manufacturerTitle,
  manufacturerInstructions,
  canOpenManufacturerSettings,
  onClose,
  onPrimary,
  onSecondary,
}: {
  visible: boolean;
  step: FocusEducationStep;
  accessibilityGranted: boolean;
  manufacturerTitle?: string;
  manufacturerInstructions?: string;
  canOpenManufacturerSettings?: boolean;
  onClose: () => void;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/35 px-md pb-md">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />
        <View className="rounded-[28px] bg-white p-md">
          {step === 'accessibility' ? (
            <>
              <Text className="font-heading-bold text-section text-text">
                Enable Lock Mode
              </Text>
              <Text className="mt-3 font-body text-body text-slate-600">
                This allows Brainrot to lock all your distractions until you finish off your task.
              </Text>

              <View className="mt-5 rounded-[28px] bg-[#FCFBFF] px-5 py-5">
                <View className="rounded-2xl bg-violet-50 px-4 py-4">
                  <Text
                    className="font-heading-semibold text-card-title"
                    style={{ color: BRAND_PURPLE }}
                  >
                    Without it, you won&apos;t get:
                  </Text>
                  {[
                    'blocking for locked apps',
                    'reliable Focus Sessions',
                    'consistent protection when distractions open',
                  ].map((item) => (
                    <View key={item} className="mt-3 flex-row items-center">
                      <Ionicons name="close" size={16} color="#EF4444" />
                      <Text className="ml-3 font-body text-body text-slate-700">
                        {item}
                      </Text>
                    </View>
                  ))}
                </View>
                <Image
                  source={blockingPreview}
                  resizeMode="contain"
                  style={{ width: '100%', height: 208, marginTop: 12 }}
                />
              </View>

              <TouchableOpacity
                onPress={onPrimary}
                className="mt-md flex-row items-center justify-center rounded-2xl bg-accent px-4 py-4"
              >
                <Text className="font-heading-semibold text-card-title text-white">
                  {accessibilityGranted ? 'Continue' : 'Enable Protection'}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color="#FFFFFF"
                  style={{ marginLeft: 10 }}
                />
              </TouchableOpacity>

              {!accessibilityGranted ? (
                <TouchableOpacity
                  onPress={onSecondary}
                  className="mt-3 items-center rounded-2xl border border-slate-200 bg-white px-4 py-4"
                >
                  <Text className="font-heading-semibold text-card-title text-slate-700">
                    I&apos;ll set this up later
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <>
              <Text className="font-heading-bold text-section text-text">
                {manufacturerTitle || 'Keep Focus Protection Reliable'}
              </Text>
              <Text className="mt-3 font-body text-body text-slate-600">
                Some phones need extra battery and background settings so Lock Mode and Focus Sessions keep working consistently.
              </Text>

              <View className="mt-5 rounded-[28px] bg-[#FCFBFF] px-5 py-5">
                <View className="rounded-2xl bg-violet-50 px-4 py-4">
                  <Text
                    className="font-heading-semibold text-card-title"
                    style={{ color: BRAND_PURPLE }}
                  >
                    What to check
                  </Text>
                  <Text className="mt-3 font-body text-body text-slate-700">
                    {manufacturerInstructions ||
                      'Disable battery restrictions and allow Brainrot to keep working in the background.'}
                  </Text>
                </View>
                <View className="mt-4 rounded-2xl bg-white px-4 py-4">
                  {[
                    'Allow background activity',
                    'Disable battery optimization for Brainrot',
                    'Open your phone-specific settings if needed',
                  ].map((item) => (
                    <View key={item} className="mb-3 flex-row items-center last:mb-0">
                      <Ionicons name="checkmark" size={18} color="#16A34A" />
                      <Text className="ml-3 flex-1 font-body text-body text-slate-700">
                        {item}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                onPress={onPrimary}
                className="mt-md flex-row items-center justify-center rounded-2xl bg-accent px-4 py-4"
              >
                <Text className="font-heading-semibold text-card-title text-white">
                  {canOpenManufacturerSettings ? 'Open OEM Settings' : 'Continue'}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color="#FFFFFF"
                  style={{ marginLeft: 10 }}
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onSecondary}
                className="mt-3 items-center rounded-2xl border border-slate-200 bg-white px-4 py-4"
              >
                <Text className="font-heading-semibold text-card-title text-slate-700">
                  I&apos;ll do this later
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

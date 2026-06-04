// AppSelectionBottomSheet.tsx
import { MaterialIcons } from '@expo/vector-icons';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import type { AppSelectionBottomSheetProps, AppSelectionItem } from '../types';

export default function AppSelectionBottomSheet({
  isOpen,
  onClose,
  onSave,
  availableApps,
  currentlyMonitored,
}: AppSelectionBottomSheetProps) {
  const [apps, setApps] = useState<AppSelectionItem[]>([]);
  const [filteredApps, setFilteredApps] = useState<AppSelectionItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCount, setSelectedCount] = useState(0);

  // Initialize when opened
  useEffect(() => {
    if (isOpen) {
      // Filter out currently monitored apps (parent may already omit them, but keep this safe)
      const init = (availableApps || [])
        .filter(app => !currentlyMonitored.includes(app.packageName))
        .map(app => ({ ...app, isSelected: !!app.isSelected }));
      setApps(init);
      setFilteredApps(init);
      setQuery('');
    }
  }, [isOpen, availableApps, currentlyMonitored]);

  // Search filter
  useEffect(() => {
    if (!query.trim()) {
      setFilteredApps(apps);
      return;
    }
    const q = query.toLowerCase();
    setFilteredApps(
      apps.filter(a =>
        a.appName.toLowerCase().includes(q) ||
        a.packageName.toLowerCase().includes(q) ||
        (a.category || '').toLowerCase().includes(q)
      )
    );
  }, [query, apps]);

  // Selected count
  useEffect(() => {
    setSelectedCount(apps.filter(a => a.isSelected).length);
  }, [apps]);

  const toggleSelection = (packageName: string) => {
    setApps(prev => prev.map(a => a.packageName === packageName ? { ...a, isSelected: !a.isSelected } : a));
  };

  const handleSelectAll = () => {
    const willSelectAll = !filteredApps.every(a => a.isSelected);
    setApps(prev =>
      prev.map(a => (filteredApps.some(f => f.packageName === a.packageName) ? { ...a, isSelected: willSelectAll } : a))
    );
  };

  const handleSave = () => {
    const selected = apps.filter(a => a.isSelected).map(a => a.packageName);
    onSave(selected);
    onClose();
  };

  const renderItem = useCallback(
    ({ item }: { item: AppSelectionItem }) => (
      <AppSelectionRow item={item} onPress={toggleSelection} />
    ),
    []
  );

  const emptyState = useMemo(
    () => (
      <View style={styles.emptyContainer}>
        <MaterialIcons name="search" size={48} color="#D1D5DB" />
        <Text style={styles.emptyText}>
          {query ? 'No apps found matching your search' : 'All available apps are already being monitored'}
        </Text>
      </View>
    ),
    [query]
  );

  // If not open, don't render modal content
  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Backdrop */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Sheet */}
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add Apps to Monitor</Text>
              <Text style={styles.subtitle}>Select apps you want to track for brain health scoring</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconButton}>
              <MaterialIcons name="close" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <MaterialIcons name="search" size={20} color="#64748B" style={styles.searchIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search apps..."
              placeholderTextColor="#64748B"
              style={styles.searchInput}
              returnKeyType="search"
            />
            {filteredApps.length > 0 && (
              <TouchableOpacity onPress={handleSelectAll} style={styles.selectAllButton}>
                <Text style={styles.selectAllText}>{filteredApps.every(a => a.isSelected) ? 'Deselect All' : 'Select All'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Count / empty state */}
          <View style={styles.countRow}>
            <Text style={styles.countText}>{filteredApps.length} apps available</Text>
            <Text style={styles.countTextRight}>{selectedCount} selected</Text>
          </View>

          {/* List */}
          <FlatList
            data={filteredApps}
            keyExtractor={item => item.packageName}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 12 }}
            renderItem={renderItem}
            ListEmptyComponent={emptyState}
            initialNumToRender={16}
            maxToRenderPerBatch={16}
            windowSize={8}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={Platform.OS === 'android'}
          />

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              disabled={selectedCount === 0}
              style={[styles.addButton, selectedCount === 0 ? styles.addButtonDisabled : null]}
            >
              <MaterialIcons name="add" size={16} color={selectedCount === 0 ? '#9CA3AF' : '#fff'} />
              <Text style={[styles.addButtonText, selectedCount === 0 ? { color: '#9CA3AF' } : {}]}>
                {selectedCount > 0 ? `Add ${selectedCount} App${selectedCount > 1 ? 's' : ''}` : 'Add Apps'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const AppSelectionRow = memo(function AppSelectionRow({
  item,
  onPress,
}: {
  item: AppSelectionItem;
  onPress: (packageName: string) => void;
}) {
  const handlePress = useCallback(() => {
    onPress(item.packageName);
  }, [item.packageName, onPress]);

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.8} style={[styles.itemRow, item.isSelected ? styles.itemSelected : styles.itemDefault]}>
      <View style={{ flex: 1 }}>
        <View style={styles.itemHeader}>
          <Text numberOfLines={1} style={styles.itemTitle}>{item.appName}</Text>
          {item.isRecommended && <View style={styles.recommendedBadge}><Text style={styles.recommendedText}>Recommended</Text></View>}
        </View>
        <Text numberOfLines={1} style={styles.itemSubtitle}>{item.packageName}</Text>
        {item.category ? <Text numberOfLines={1} style={styles.itemCategory}>{item.category}</Text> : null}
      </View>

      <View style={[styles.checkboxBase, item.isSelected ? styles.checkboxChecked : styles.checkboxUnchecked]}>
        {item.isSelected && <MaterialIcons name="check" size={14} color="#fff" />}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  handleContainer: { alignItems: 'center', paddingBottom: 6 },
  handle: { width: 48, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title: { fontSize: 16, fontFamily: 'PlusJakartaSans_600SemiBold', color: '#0F172A' },
  subtitle: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_400Regular' },
  iconButton: { padding: 8 },

  searchContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 38, borderRadius: 8, backgroundColor: '#F8F9FC', paddingHorizontal: 12, color: '#0F172A', fontSize: 14, fontFamily: 'Inter_400Regular' },
  selectAllButton: { marginLeft: 8 },

  selectAllText: { color: '#5B4CF0', fontSize: 12, fontFamily: 'PlusJakartaSans_600SemiBold' },

  countRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  countText: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_400Regular' },
  countTextRight: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_400Regular' },

  list: { paddingHorizontal: 16, paddingTop: 8 },

  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  itemDefault: { borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  itemSelected: { borderColor: '#CFC9FF', backgroundColor: '#F3F1FF' },

  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: { color: '#0F172A', fontSize: 16, fontFamily: 'PlusJakartaSans_600SemiBold' },
  recommendedBadge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#ECE9FF', borderRadius: 6, marginLeft: 8 },
  recommendedText: { color: '#5B4CF0', fontSize: 11, fontFamily: 'PlusJakartaSans_600SemiBold' },
  itemSubtitle: { color: '#64748B', fontSize: 12, marginTop: 2, fontFamily: 'Inter_400Regular' },
  itemCategory: { color: '#64748B', fontSize: 12, marginTop: 2, fontFamily: 'Inter_400Regular' },

  checkboxBase: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkboxUnchecked: { borderWidth: 2, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  checkboxChecked: { backgroundColor: '#5B4CF0', borderColor: '#5B4CF0' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
  emptyText: { color: '#64748B', marginTop: 8, fontSize: 12, fontFamily: 'Inter_400Regular' },

  footer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6', backgroundColor: '#FFFFFF' },

  cancelButton: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', marginRight: 8, alignItems: 'center' },
  cancelText: { color: '#0F172A', fontSize: 16, fontFamily: 'PlusJakartaSans_600SemiBold' },

  addButton: { flex: 1, padding: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#5B4CF0' },
  addButtonDisabled: { backgroundColor: '#E5E7EB' },
  addButtonText: { color: '#fff', fontSize: 16, fontFamily: 'PlusJakartaSans_700Bold', marginLeft: 8 },
});

// AppSelectionBottomSheet.tsx
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
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
              <MaterialIcons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <MaterialIcons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search apps..."
              placeholderTextColor="#9CA3AF"
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
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => toggleSelection(item.packageName)} activeOpacity={0.8} style={[styles.itemRow, item.isSelected ? styles.itemSelected : styles.itemDefault]}>
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
            )}
            ListEmptyComponent={() => (
              <View style={styles.emptyContainer}>
                <MaterialIcons name="search" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>
                  {query ? 'No apps found matching your search' : 'All available apps are already being monitored'}
                </Text>
              </View>
            )}
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

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  handleContainer: { alignItems: 'center', paddingBottom: 6 },
  handle: { width: 48, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title: { fontSize: 16, fontWeight: '600', color: '#111827' },
  subtitle: { color: '#6B7280', fontSize: 13 },
  iconButton: { padding: 8 },

  searchContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 38, borderRadius: 8, backgroundColor: '#F9FAFB', paddingHorizontal: 12, color: '#111827' },
  selectAllButton: { marginLeft: 8 },

  selectAllText: { color: '#4F46E5', fontWeight: '600' },

  countRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  countText: { color: '#6B7280', fontSize: 13 },
  countTextRight: { color: '#6B7280', fontSize: 13 },

  list: { paddingHorizontal: 16, paddingTop: 8 },

  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  itemDefault: { borderColor: '#E5E7EB', backgroundColor: '#fff' },
  itemSelected: { borderColor: '#C7D2FE', backgroundColor: '#EEF2FF' },

  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: { color: '#111827', fontWeight: '600', fontSize: 15 },
  recommendedBadge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#EEF2FF', borderRadius: 6, marginLeft: 8 },
  recommendedText: { color: '#4F46E5', fontSize: 11, fontWeight: '600' },
  itemSubtitle: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  itemCategory: { color: '#9CA3AF', fontSize: 11, marginTop: 2 },

  checkboxBase: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkboxUnchecked: { borderWidth: 2, borderColor: '#D1D5DB', backgroundColor: '#fff' },
  checkboxChecked: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
  emptyText: { color: '#6B7280', marginTop: 8 },

  footer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6', backgroundColor: '#fff' },

  cancelButton: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff', marginRight: 8, alignItems: 'center' },
  cancelText: { color: '#374151', fontWeight: '600' },

  addButton: { flex: 1, padding: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4F46E5' },
  addButtonDisabled: { backgroundColor: '#E5E7EB' },
  addButtonText: { color: '#fff', fontWeight: '700', marginLeft: 8 },
});

import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const openPrivacyPolicy = () => {
    WebBrowser.openBrowserAsync('https://sosedinet.ru/privacy');
  };

  const openSupport = () => {
    WebBrowser.openBrowserAsync('https://sosedinet.ru/support');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Приложение</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Версия</Text>
          <Text style={styles.rowValue}>{appVersion}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Информация</Text>
        <TouchableOpacity style={styles.row} onPress={openPrivacyPolicy}>
          <Text style={styles.rowLabel}>Политика конфиденциальности</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={openSupport}>
          <Text style={styles.rowLabel}>Поддержка</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  section: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#c8c8cc',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6d6d72',
    textTransform: 'uppercase',
    marginLeft: 16,
    marginBottom: 6,
    marginTop: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#c8c8cc',
  },
  rowLabel: {
    fontSize: 16,
    color: '#000',
  },
  rowValue: {
    fontSize: 16,
    color: '#8e8e93',
  },
  rowChevron: {
    fontSize: 20,
    color: '#c7c7cc',
  },
});

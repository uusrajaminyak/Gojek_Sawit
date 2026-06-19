import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    async function checkForUpdates() {
      try {
        if (__DEV__) return;

        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          setIsUpdating(true);
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (error) {
        console.error("Error checking for updates:", error);
      }
    }

    checkForUpdates();
  }, []);

  if (isUpdating) {
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1E293B'
      }}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={{ color: '#F8FAFC', marginTop: 16, fontSize: 16, fontWeight: 'bold' }}>
          Memeriksa pembaruan...
        </Text>
        <Text style={{ color: '#94A3B8', marginTop: 8, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 }}>
          Mengunduh pembaruan...
        </Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
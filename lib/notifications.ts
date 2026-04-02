import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const SITE_URL = 'https://sosedinet.ru';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Request push permission, get token, register with backend */
export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync();

  // Register token with backend
  try {
    await fetch(`${SITE_URL}/api/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        token,
        platform: Platform.OS,
      }),
    });
  } catch (err) {
    console.error('Failed to register push token:', err);
  }

  return token;
}

/** Set app icon badge count */
export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}

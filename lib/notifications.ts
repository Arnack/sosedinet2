import * as Notifications from 'expo-notifications';
import type { Notification } from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification behavior (foreground presentation + badge)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let cachedExpoPushToken: string | null = null;
let pushRegistrationFinished = false;
const pushTokenListeners = new Set<(token: string | null) => void>();

let nativePushTokenListenerAttached = false;

function notifyPushTokenListeners(token: string | null) {
  cachedExpoPushToken = token;
  pushRegistrationFinished = true;
  pushTokenListeners.forEach((cb) => {
    try {
      cb(token);
    } catch (e) {
      console.warn('pushToken listener error', e);
    }
  });
}

/** Current Expo push token after registration (null if denied or pending). */
export function getCachedExpoPushToken(): string | null {
  return cachedExpoPushToken;
}

/**
 * Subscribe to Expo push token (initial registration and FCM/APNs token rotations).
 * Unsubscribe in cleanup when the WebView unmounts.
 */
export function onExpoPushTokenReady(cb: (token: string | null) => void): () => void {
  pushTokenListeners.add(cb);
  if (pushRegistrationFinished) {
    queueMicrotask(() => cb(cachedExpoPushToken));
  }
  return () => pushTokenListeners.delete(cb);
}

function extractBadgeFromNotification(notification: Notification): number | null {
  const c = notification.request.content;
  const badgeField =
    typeof (c as { badge?: number | null }).badge === 'number'
      ? (c as { badge: number }).badge
      : null;
  if (badgeField !== null && Number.isFinite(badgeField)) {
    return Math.max(0, Math.floor(badgeField));
  }
  const data = c.data ?? {};
  const raw = data.badge ?? data.unreadCount ?? data.count;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) return Math.max(0, n);
  }
  return null;
}

/** JS snippet: POST push token with WebView cookies (run via injectJavaScript). */
export function buildPushTokenInjectScript(token: string, platform: string): string {
  const body = JSON.stringify({ token, platform });
  return `(function(){
    try {
      fetch('/api/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: ${JSON.stringify(body)}
      })
        .then(function(r){
          return r.text().then(function(t){
            var parsed = t;
            try { parsed = JSON.parse(t); } catch (e) {}
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'pushTokenRegister',
                ok: r.ok,
                status: r.status,
                body: typeof parsed === 'string' ? parsed.slice(0, 300) : parsed
              }));
            }
          });
        })
        .catch(function(err){
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'pushTokenRegister',
              ok: false,
              status: 0,
              error: String(err)
            }));
          }
        });
    } catch (e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'pushTokenRegister',
          ok: false,
          status: 0,
          error: String(e)
        }));
      }
    }
  })(); true;`;
}

/** JS snippet: refresh unread count → postMessage to RN (same as injected poll). */
export function buildBadgePollInjectScript(): string {
  return `(function(){
    fetch('/api/notifications/unread-count', { credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (data && typeof data.count === 'number' && window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'badge', count: data.count }));
        }
      })
      .catch(function(){});
  })(); true;`;
}

async function setBadgeCountAsyncSafe(count: number): Promise<void> {
  try {
    const n = Math.max(0, Math.floor(Number(count)) || 0);
    await Notifications.setBadgeCountAsync(n);
  } catch (e) {
    console.warn('setBadgeCountAsync failed', e);
  }
}

/** Set launcher icon badge (iOS / supported Android launchers). */
export async function setBadgeCount(count: number) {
  await setBadgeCountAsyncSafe(count);
}

async function applyBadgeFromNotificationIfPresent(notification: Notification) {
  const b = extractBadgeFromNotification(notification);
  if (b !== null) await setBadgeCountAsyncSafe(b);
}

/**
 * Subscribe to push delivery / taps so badge can track server-sent badge fields.
 * Call once from root layout.
 */
export function subscribeNotificationBadgeEffects(): () => void {
  const subs: { remove: () => void }[] = [];

  subs.push(
    Notifications.addNotificationReceivedListener((notification) => {
      void applyBadgeFromNotificationIfPresent(notification);
    })
  );

  subs.push(
    Notifications.addNotificationResponseReceivedListener((response) => {
      void applyBadgeFromNotificationIfPresent(response.notification);
    })
  );

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response?.notification) {
      void applyBadgeFromNotificationIfPresent(response.notification);
    }
  });

  return () => subs.forEach((s) => s.remove());
}

/** Request push permission, channel, token; token is registered from WebView with session cookies. */
export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    notifyPushTokenListeners(null);
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Уведомления',
      importance: Notifications.AndroidImportance.MAX,
      showBadge: true,
    });
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    notifyPushTokenListeners(token);

    if (!nativePushTokenListenerAttached) {
      nativePushTokenListenerAttached = true;
      Notifications.addPushTokenListener(async () => {
        try {
          const { data: next } = await Notifications.getExpoPushTokenAsync();
          notifyPushTokenListeners(next);
        } catch (err) {
          console.warn('Expo push token refresh failed', err);
        }
      });
    }

    return token;
  } catch (e) {
    console.error('getExpoPushTokenAsync failed', e);
    notifyPushTokenListeners(null);
    return null;
  }
}

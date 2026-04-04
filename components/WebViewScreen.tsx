import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ActivityIndicator,
  View,
  Text,
  Platform,
  BackHandler,
  Modal,
  Pressable,
  AppState,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebViewMessageEvent } from 'react-native-webview';
import {
  buildBadgePollInjectScript,
  buildPushTokenInjectScript,
  getCachedExpoPushToken,
  onExpoPushTokenReady,
  setBadgeCount,
} from '@/lib/notifications';

const SITE_URL = 'https://sosedinet.ru';

const BADGE_POLL_INTERVAL = 60000; // 60 seconds

const INJECTED_JS = `
  (function() {
    // Force all links to open in same window
    document.addEventListener('click', function(e) {
      var el = e.target.closest('a');
      if (el && el.target === '_blank') {
        e.preventDefault();
        window.location.href = el.href;
      }
    }, true);

    // Poll unread notification count and send to RN for badge
    function pollBadgeCount() {
      fetch('/api/notifications/unread-count', { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (data && typeof data.count === 'number') {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'badge', count: data.count }));
          }
        })
        .catch(function() {});
    }
    pollBadgeCount();
    setInterval(pollBadgeCount, ${BADGE_POLL_INTERVAL});
  })();
  true;
`;

export default function WebViewScreen() {
  const webViewRef = useRef<WebView>(null);
  const lastNavUrlRef = useRef<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const androidBottomPad =
    Platform.OS === 'android' ? Math.max(insets.bottom, 8) : insets.bottom;

  const injectPushToken = useCallback((token: string) => {
    webViewRef.current?.injectJavaScript(
      buildPushTokenInjectScript(token, Platform.OS)
    );
  }, []);

  useEffect(() => {
    return onExpoPushTokenReady((token) => {
      if (token) injectPushToken(token);
    });
  }, [injectPushToken]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        webViewRef.current?.injectJavaScript(buildBadgePollInjectScript());
        const t = getCachedExpoPushToken();
        if (t) injectPushToken(t);
      }
    });
    return () => sub.remove();
  }, [injectPushToken]);

  // WebView often omits re-running onLoadEnd after client-side login; retry token registration.
  useEffect(() => {
    const id = setInterval(() => {
      const t = getCachedExpoPushToken();
      if (t) injectPushToken(t);
    }, 45000);
    return () => clearInterval(id);
  }, [injectPushToken]);

  // Android hardware back: WebView history, then exit confirmation (avoid silent app exit)
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const onBackPress = () => {
        if (exitConfirmVisible) {
          setExitConfirmVisible(false);
          return true;
        }
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        setExitConfirmVisible(true);
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [canGoBack, exitConfirmVisible])
  );

  const onNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      setCanGoBack(navState.canGoBack);
      const url = navState.url;
      if (url && url !== lastNavUrlRef.current) {
        lastNavUrlRef.current = url;
        const t = getCachedExpoPushToken();
        if (t) injectPushToken(t);
      }
    },
    [injectPushToken]
  );

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'badge' && typeof data.count === 'number') {
        void setBadgeCount(data.count);
      }
      if (data.type === 'pushTokenRegister' && !data.ok) {
        console.warn(
          '[SosediNet] /api/push-token failed',
          data.status,
          data.body ?? data.error
        );
      }
    } catch {}
  };

  const onShouldStartLoadWithRequest = (request: ShouldStartLoadRequest) => {
    // Allow all sosedinet.ru URLs
    if (request.url.includes('sosedinet.ru')) return true;
    // Allow common auth providers, payment, etc.
    return true;
  };

  if (hasError) {
    return (
      <View
        style={[
          styles.center,
          { paddingTop: insets.top, paddingBottom: androidBottomPad },
        ]}>
        <Text style={styles.errorTitle}>Нет соединения</Text>
        <Text style={styles.errorText}>Проверьте подключение к интернету</Text>
        <Text
          style={styles.retry}
          onPress={() => {
            setHasError(false);
            setInitialLoad(true);
          }}>
          Повторить
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: androidBottomPad },
      ]}>
      <WebView
        ref={webViewRef}
        source={{ uri: SITE_URL }}
        style={styles.webview}
        onNavigationStateChange={onNavigationStateChange}
        onLoadEnd={() => {
          setInitialLoad(false);
          const t = getCachedExpoPushToken();
          if (t) injectPushToken(t);
        }}
        onError={() => setHasError(true)}
        onHttpError={(syntheticEvent) => {
          if (syntheticEvent.nativeEvent.statusCode >= 500) {
            setHasError(true);
          }
        }}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onOpenWindow={(syntheticEvent) => {
          // Handle target="_blank" — load in same WebView
          const { targetUrl } = syntheticEvent.nativeEvent;
          webViewRef.current?.injectJavaScript(
            `window.location.href = '${targetUrl}'; true;`
          );
        }}
        injectedJavaScript={INJECTED_JS}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
      />
      {initialLoad && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#2f95dc" />
        </View>
      )}

      <Modal
        visible={exitConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExitConfirmVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setExitConfirmVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Выйти из приложения?</Text>
            <Text style={styles.modalBody}>
              Системная кнопка «Назад» закроет приложение. Продолжить?
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalBtn, pressed && styles.modalBtnPressed]}
                onPress={() => setExitConfirmVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Остаться</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  pressed && styles.modalBtnPressed,
                ]}
                onPress={() => {
                  setExitConfirmVisible(false);
                  BackHandler.exitApp();
                }}>
                <Text style={styles.modalBtnExitText}>Выйти</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  retry: {
    fontSize: 16,
    color: '#2f95dc',
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    color: '#111',
  },
  modalBody: {
    fontSize: 15,
    color: '#555',
    lineHeight: 21,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  modalBtnPrimary: {
    backgroundColor: '#2f95dc',
  },
  modalBtnPressed: {
    opacity: 0.85,
  },
  modalBtnCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  modalBtnExitText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

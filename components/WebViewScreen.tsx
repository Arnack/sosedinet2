import React, { useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  ActivityIndicator,
  View,
  Text,
  Platform,
  BackHandler,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebViewMessageEvent } from 'react-native-webview';
import { setBadgeCount } from '@/lib/notifications';

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
  const [canGoBack, setCanGoBack] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [hasError, setHasError] = useState(false);
  const insets = useSafeAreaInsets();

  // Android hardware back button
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const onBackPress = () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [canGoBack])
  );

  const onNavigationStateChange = (navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'badge' && typeof data.count === 'number') {
        setBadgeCount(data.count);
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
      <View style={styles.center}>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <WebView
        ref={webViewRef}
        source={{ uri: SITE_URL }}
        style={styles.webview}
        onNavigationStateChange={onNavigationStateChange}
        onLoadEnd={() => setInitialLoad(false)}
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
});

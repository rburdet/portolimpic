import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Bell, BellOff, Wind, AlertTriangle } from 'lucide-react';

interface NotificationSettings {
  enabled: boolean;
  windSpeedThreshold: number;
  gustThreshold: number;
  email?: string;
  pushEnabled: boolean;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: false,
    windSpeedThreshold: 20,
    gustThreshold: 25,
    pushEnabled: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);

  // Check if browser supports notifications
  const supportsNotifications = 'Notification' in window && 'serviceWorker' in navigator;

  useEffect(() => {
    loadSettings();
    checkPushSubscription();
  }, []);

  const showMessage = (message: string, isError = false) => {
    // Simple alert for now - you can replace with a toast library later
    alert(`${isError ? 'Error: ' : ''}${message}`);
  };

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/notifications/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error);
    }
  };

  const checkPushSubscription = async () => {
    if (!supportsNotifications) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        setPushSubscription({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
            auth: arrayBufferToBase64(subscription.getKey('auth')!)
          }
        });
      }
    } catch (error) {
      console.error('Failed to check push subscription:', error);
    }
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binary);
  };

  const requestNotificationPermission = async () => {
    if (!supportsNotifications) {
      showMessage('Your browser does not support notifications', true);
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  };

  const subscribeToPush = async () => {
    if (!supportsNotifications) return null;

    try {
      const registration = await navigator.serviceWorker.ready;
      
      const vapidPublicKey = 'BC_UmB_RatxI4MGXKw97vu4lORchUuYq8-hltnKe7H_LzqiG8jlm15_zqpkU5UGpcWAF1deGiI-lm3a8neyi6fo';
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      const pushSub = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
          auth: arrayBufferToBase64(subscription.getKey('auth')!)
        }
      };

      setPushSubscription(pushSub);
      return pushSub;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      showMessage('Failed to enable push notifications', true);
      return null;
    }
  };

  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const handleEnableNotifications = async () => {
    if (!settings.enabled) {
      const hasPermission = await requestNotificationPermission();
      if (!hasPermission) {
        showMessage('Notification permission denied', true);
        return;
      }

      if (settings.pushEnabled) {
        await subscribeToPush();
      }
    }

    setSettings(prev => ({ ...prev, enabled: !prev.enabled }));
  };

  const handlePushToggle = async () => {
    if (!settings.pushEnabled) {
      const hasPermission = await requestNotificationPermission();
      if (!hasPermission) return;

      const subscription = await subscribeToPush();
      if (!subscription) return;
    }

    setSettings(prev => ({ ...prev, pushEnabled: !prev.pushEnabled }));
  };

  const saveSettings = async () => {
    setIsLoading(true);
    try {
      const payload = {
        ...settings,
        pushSubscription: settings.pushEnabled ? pushSubscription : null
      };

      const response = await fetch('/api/notifications/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showMessage('Notification settings saved!');
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save notification settings:', error);
      showMessage('Failed to save settings', true);
    } finally {
      setIsLoading(false);
    }
  };

  const testNotification = async () => {
    try {
      const response = await fetch('/api/notifications/test', { method: 'POST' });
      if (response.ok) {
        showMessage('Test notification sent!');
      } else {
        throw new Error('Failed to send test notification');
      }
    } catch (error) {
      console.error('Failed to send test notification:', error);
      showMessage('Failed to send test notification', true);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {settings.enabled ? <Bell className="h-5 w-5 text-blue-600" /> : <BellOff className="h-5 w-5 text-gray-400" />}
          Wind Alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Notifications */}
        <div className="flex items-center justify-between">
          <Label htmlFor="notifications-enabled" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Enable Alerts
          </Label>
          <Switch
            id="notifications-enabled"
            checked={settings.enabled}
            onCheckedChange={handleEnableNotifications}
          />
        </div>

        {settings.enabled && (
          <>
            {/* Wind Speed Threshold */}
            <div className="space-y-2">
              <Label htmlFor="wind-threshold" className="flex items-center gap-2">
                <Wind className="h-4 w-4" />
                Wind Speed Alert (knots)
              </Label>
              <Input
                id="wind-threshold"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={settings.windSpeedThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings(prev => ({ 
                  ...prev, 
                  windSpeedThreshold: parseFloat(e.target.value) || 0 
                }))}
              />
              <p className="text-xs text-gray-500">
                Alert when wind speed exceeds this threshold
              </p>
            </div>

            {/* Gust Threshold */}
            <div className="space-y-2">
              <Label htmlFor="gust-threshold" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Gust Alert (knots)
              </Label>
              <Input
                id="gust-threshold"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={settings.gustThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings(prev => ({ 
                  ...prev, 
                  gustThreshold: parseFloat(e.target.value) || 0 
                }))}
              />
              <p className="text-xs text-gray-500">
                Alert when gusts exceed this threshold
              </p>
            </div>

            {/* Email Notifications */}
            <div className="space-y-2">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={settings.email || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings(prev => ({ 
                  ...prev, 
                  email: e.target.value 
                }))}
              />
            </div>

            {/* Push Notifications */}
            {supportsNotifications && (
              <div className="flex items-center justify-between">
                <Label htmlFor="push-notifications">
                  Browser Push Notifications
                </Label>
                <Switch
                  id="push-notifications"
                  checked={settings.pushEnabled}
                  onCheckedChange={handlePushToggle}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button 
                onClick={saveSettings} 
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? 'Saving...' : 'Save Settings'}
              </Button>
              <Button 
                variant="outline" 
                onClick={testNotification}
                disabled={!settings.enabled}
              >
                Test
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
} 
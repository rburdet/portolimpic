interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_EMAIL: string;
  RESEND_API_KEY?: string; // For email notifications
}

interface UserSubscription {
  id: number;
  user_id: string;
  email?: string;
  push_endpoint?: string;
  push_keys?: string;
  wind_speed_threshold: number;
  gust_threshold: number;
  active: boolean;
}

interface WindData {
  wind_speed_knots: number;
  max_wind_knots: number;
  datetime: string;
  location?: string;
}

export class NotificationService {
  constructor(private env: Env) {}

  // Main cron function - call this every 5 minutes
  async checkAndSendNotifications(windData: WindData): Promise<void> {
    try {
      // Get all active subscriptions
      const subscriptions = await this.getActiveSubscriptions();
      
      // Check each subscription against thresholds
      for (const subscription of subscriptions) {
        await this.checkThresholdsAndNotify(subscription, windData);
      }
    } catch (error) {
      console.error('Error in notification check:', error);
    }
  }

  private async getActiveSubscriptions(): Promise<UserSubscription[]> {
    const result = await this.env.DB.prepare(`
      SELECT * FROM user_subscriptions 
      WHERE active = true
    `).all();

    return result.results as UserSubscription[];
  }

  private async checkThresholdsAndNotify(
    subscription: UserSubscription, 
    windData: WindData
  ): Promise<void> {
    const notifications: Array<{
      type: 'wind_speed' | 'gust';
      threshold: number;
      actual: number;
    }> = [];

    // Check wind speed threshold
    if (windData.wind_speed_knots > subscription.wind_speed_threshold) {
      notifications.push({
        type: 'wind_speed',
        threshold: subscription.wind_speed_threshold,
        actual: windData.wind_speed_knots
      });
    }

    // Check gust threshold
    if (windData.max_wind_knots > subscription.gust_threshold) {
      notifications.push({
        type: 'gust',
        threshold: subscription.gust_threshold,
        actual: windData.max_wind_knots
      });
    }

    // Send notifications if any thresholds exceeded
    for (const notification of notifications) {
      const shouldSend = await this.shouldSendNotification(
        subscription.user_id,
        notification.type,
        notification.threshold
      );

      if (shouldSend) {
        await this.sendNotification(subscription, notification, windData);
        await this.recordNotification(subscription.user_id, notification, windData.location);
      }
    }
  }

  private async shouldSendNotification(
    userId: string,
    type: string,
    threshold: number
  ): Promise<boolean> {
    // Prevent spam - don't send same type of notification within 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const result = await this.env.DB.prepare(`
      SELECT COUNT(*) as count FROM notification_history 
      WHERE user_id = ? 
        AND notification_type = ? 
        AND threshold_value = ?
        AND sent_at > ?
    `).bind(userId, type, threshold, oneHourAgo).first();

    return (result?.count as number) === 0;
  }

  private async sendNotification(
    subscription: UserSubscription,
    notification: { type: string; threshold: number; actual: number },
    windData: WindData
  ): Promise<void> {
    const message = this.createNotificationMessage(notification, windData);

    // Send push notification
    if (subscription.push_endpoint && subscription.push_keys) {
      await this.sendPushNotification(
        subscription.push_endpoint,
        subscription.push_keys,
        message
      );
    }

    // Send email notification
    if (subscription.email) {
      await this.sendEmailNotification(subscription.email, message);
    }
  }

  private createNotificationMessage(
    notification: { type: string; threshold: number; actual: number },
    windData: WindData
  ): { title: string; body: string; icon?: string } {
    const isGust = notification.type === 'gust';
    const title = isGust ? '🌪️ Wind Gust Alert!' : '💨 Wind Speed Alert!';
    
    const body = isGust 
      ? `Gusts reached ${notification.actual.toFixed(1)} knots (threshold: ${notification.threshold} kn)`
      : `Wind speed reached ${notification.actual.toFixed(1)} knots (threshold: ${notification.threshold} kn)`;

    return {
      title,
      body: `${body}\nTime: ${new Date(windData.datetime).toLocaleString()}`,
      icon: '/wind-icon.png' // Add an icon to your public folder
    };
  }

  private async sendPushNotification(
    endpoint: string,
    keysJson: string,
    message: { title: string; body: string; icon?: string }
  ): Promise<void> {
    try {
      const keys = JSON.parse(keysJson);
      
      // Create JWT for VAPID
      const jwt = await this.createVapidJWT();
      
      // Encrypt payload
      const payload = JSON.stringify({
        title: message.title,
        body: message.body,
        icon: message.icon,
        badge: '/badge-icon.png',
        tag: 'wind-alert',
        renotify: true,
        actions: [
          {
            action: 'view',
            title: 'View Details'
          }
        ]
      });

      // Send to browser push service
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `vapid t=${jwt}, k=${this.env.VAPID_PUBLIC_KEY}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'TTL': '86400' // 24 hours
        },
        body: await this.encryptPayload(payload, keys)
      });

      if (!response.ok) {
        throw new Error(`Push notification failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send push notification:', error);
    }
  }

  private async sendEmailNotification(
    email: string,
    message: { title: string; body: string }
  ): Promise<void> {
    if (!this.env.RESEND_API_KEY) return;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Wind Alerts <alerts@yourdomain.com>',
          to: [email],
          subject: message.title,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">${message.title}</h2>
              <p style="font-size: 16px; line-height: 1.5;">${message.body.replace(/\n/g, '<br>')}</p>
              <div style="margin-top: 20px; padding: 15px; background-color: #f3f4f6; border-radius: 8px;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">
                  You can update your notification preferences in the app settings.
                </p>
              </div>
            </div>
          `
        })
      });

      if (!response.ok) {
        throw new Error(`Email notification failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send email notification:', error);
    }
  }

  private async recordNotification(
    userId: string,
    notification: { type: string; threshold: number; actual: number },
    location?: string
  ): Promise<void> {
    await this.env.DB.prepare(`
      INSERT INTO notification_history 
      (user_id, notification_type, threshold_value, actual_value, location)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      userId,
      notification.type,
      notification.threshold,
      notification.actual,
      location || 'default'
    ).run();
  }

  private async createVapidJWT(): Promise<string> {
    // Simplified JWT creation - in production, use a proper JWT library
    const header = { typ: 'JWT', alg: 'ES256' };
    const payload = {
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12 hours
      sub: `mailto:${this.env.VAPID_EMAIL}`
    };

    // Note: This is a simplified version. For production, use the Web Crypto API
    // to properly sign the JWT with your VAPID private key
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(payload));
    
    return `${encodedHeader}.${encodedPayload}.signature`;
  }

  private async encryptPayload(payload: string, keys: any): Promise<ArrayBuffer> {
    // Simplified encryption - in production, implement proper Web Push encryption
    // This is a placeholder that returns the payload as ArrayBuffer
    return new TextEncoder().encode(payload);
  }

  // API endpoints
  async handleSubscriptionSave(request: Request): Promise<Response> {
    try {
      const data = await request.json();
      const userId = this.getUserId(request); // Implement your auth logic

      await this.env.DB.prepare(`
        INSERT OR REPLACE INTO user_subscriptions 
        (user_id, email, push_endpoint, push_keys, wind_speed_threshold, gust_threshold, active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        userId,
        data.email || null,
        data.pushSubscription?.endpoint || null,
        data.pushSubscription ? JSON.stringify(data.pushSubscription.keys) : null,
        data.windSpeedThreshold,
        data.gustThreshold,
        data.enabled,
      ).run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to save subscription' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async handleTestNotification(request: Request): Promise<Response> {
    try {
      const userId = this.getUserId(request);
      
      // Get user subscription
      const subscription = await this.env.DB.prepare(`
        SELECT * FROM user_subscriptions WHERE user_id = ? AND active = true
      `).bind(userId).first() as UserSubscription;

      if (!subscription) {
        return new Response(JSON.stringify({ error: 'No active subscription found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Send test notification
      const testMessage = {
        title: '🧪 Test Wind Alert',
        body: 'This is a test notification. Your wind alerts are working correctly!',
        icon: '/wind-icon.png'
      };

      if (subscription.push_endpoint && subscription.push_keys) {
        await this.sendPushNotification(
          subscription.push_endpoint,
          subscription.push_keys,
          testMessage
        );
      }

      if (subscription.email) {
        await this.sendEmailNotification(subscription.email, testMessage);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to send test notification' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private getUserId(request: Request): string {
    // Implement your authentication logic here
    // This could be from JWT token, session, etc.
    return 'user-123'; // Placeholder
  }
} 
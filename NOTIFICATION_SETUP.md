# 🔔 Wind Alert Notification System Setup

## Overview
This notification system monitors wind data every 5 minutes and sends alerts when user-defined thresholds are exceeded.

## Features
- ⏰ **Automatic monitoring** every 5 minutes via cron jobs
- 📱 **Push notifications** directly to users' browsers
- 📧 **Email alerts** for important thresholds
- 🎯 **Customizable thresholds** for wind speed and gusts
- 🚫 **Spam prevention** with cooldown periods
- 📊 **Notification history** tracking

## Setup Steps

### 1. Generate VAPID Keys
```bash
npx web-push generate-vapid-keys
```
Save the keys for your environment variables.

### 2. Create D1 Database
```bash
# Create production database
npx wrangler d1 create portolimpic-prod

# Create development database  
npx wrangler d1 create portolimpic-dev

# Apply schema
npx wrangler d1 execute portolimpic-prod --file=./worker/schema.sql
npx wrangler d1 execute portolimpic-dev --file=./worker/schema.sql
```

### 3. Update Environment Variables
In your `wrangler.jsonc`, replace placeholder values:

```json
{
  "env": {
    "production": {
      "vars": {
        "VAPID_PUBLIC_KEY": "YOUR_ACTUAL_VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY": "YOUR_ACTUAL_VAPID_PRIVATE_KEY", 
        "VAPID_EMAIL": "mailto:your-email@domain.com"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "portolimpic-prod",
          "database_id": "YOUR_ACTUAL_D1_DATABASE_ID"
        }
      ]
    }
  }
}
```

### 4. Optional: Email Notifications (Resend)
1. Sign up at [resend.com](https://resend.com)
2. Get your API key
3. Add to environment variables:
```json
"RESEND_API_KEY": "re_your_api_key"
```

### 5. Add Icons
Add these files to your `public/` directory:
- `wind-icon.png` (96x96px recommended)
- `badge-icon.png` (72x72px recommended)

### 6. Deploy
```bash
# Deploy to production
npx wrangler deploy --env production

# The cron job will automatically start running every 5 minutes
```

## How It Works

### 🔄 Cron Job Flow
1. **Every 5 minutes**: Cloudflare triggers the cron job
2. **Fetch Data**: Get latest wind readings from your API
3. **Check Subscriptions**: Query all active user subscriptions
4. **Compare Thresholds**: Check if wind speed/gusts exceed user limits
5. **Send Notifications**: Dispatch push/email alerts to affected users
6. **Record History**: Log notifications to prevent spam

### 👤 User Experience
1. **Subscribe**: Users set wind speed & gust thresholds
2. **Permission**: Browser requests notification permission
3. **Alerts**: Real-time notifications when thresholds exceeded
4. **Manage**: Users can update thresholds or disable alerts anytime

### 🛡️ Spam Prevention
- **Cooldown Period**: Same alert type limited to once per hour
- **Threshold Tracking**: Prevents duplicate notifications
- **User Control**: Easy unsubscribe/disable options

## API Endpoints

### User Subscription Management
- `POST /api/notifications/settings` - Save user preferences
- `GET /api/notifications/settings` - Get current settings
- `POST /api/notifications/test` - Send test notification

### Testing
- `POST /api/notifications/trigger` - Manually trigger cron check

## Database Schema

### user_subscriptions
- `user_id` - Unique user identifier
- `email` - Optional email for notifications
- `push_endpoint` - Browser push endpoint
- `push_keys` - Encrypted push subscription keys
- `wind_speed_threshold` - Alert when exceeded (knots)
- `gust_threshold` - Alert when exceeded (knots)
- `active` - Enable/disable notifications

### notification_history
- `user_id` - Who received the notification
- `notification_type` - 'wind_speed' or 'gust'
- `threshold_value` - The user's threshold
- `actual_value` - The actual reading that triggered alert
- `sent_at` - Timestamp for spam prevention

## Customization

### Threshold Ranges
Default ranges can be adjusted in `NotificationSettings.tsx`:
```typescript
// Current defaults
windSpeedThreshold: 20, // knots
gustThreshold: 25,      // knots
```

### Notification Frequency
Modify cron schedule in `wrangler.jsonc`:
```json
"triggers": {
  "crons": ["*/5 * * * *"]  // Every 5 minutes
}
```

### Spam Prevention Cooldown
Adjust in `notification-service.ts`:
```typescript
// Current: 1 hour cooldown
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
```

## Troubleshooting

### Check Cron Logs
```bash
npx wrangler tail --env production
```

### Test Notifications
```bash
curl -X POST https://your-domain.com/api/notifications/trigger
```

### Database Queries
```bash
npx wrangler d1 execute portolimpic-prod --command="SELECT * FROM user_subscriptions"
```

### Common Issues
1. **VAPID Keys Invalid**: Regenerate and update environment
2. **Permission Denied**: Users must explicitly allow notifications
3. **No Notifications**: Check cron logs and database subscriptions
4. **Database Errors**: Verify D1 binding and schema applied

## Security Notes

- 🔐 **VAPID keys** should be kept secret
- 🛡️ **User authentication** should be implemented for production
- 📝 **Rate limiting** recommended for API endpoints
- 🔍 **Input validation** on all user data

## Performance Considerations

- 📊 **Batch operations** for multiple users
- 🗄️ **Database indexes** on frequently queried columns
- ⚡ **Efficient queries** to minimize D1 usage
- 📈 **Monitor** notification delivery rates

---

**Need Help?** Check the Cloudflare Workers documentation or create an issue in the repository. 
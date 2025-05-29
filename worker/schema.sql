-- User notification subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  email TEXT,
  push_endpoint TEXT,
  push_keys TEXT, -- JSON object with push subscription keys
  wind_speed_threshold REAL DEFAULT 20.0,
  gust_threshold REAL DEFAULT 25.0,
  active BOOLEAN DEFAULT true,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notification history to prevent spam
CREATE TABLE IF NOT EXISTS notification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL, -- 'wind_speed' | 'gust'
  threshold_value REAL NOT NULL,
  actual_value REAL NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  location TEXT DEFAULT 'default'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_active ON user_subscriptions(active);
CREATE INDEX IF NOT EXISTS idx_notification_history_user_sent ON notification_history(user_id, sent_at); 
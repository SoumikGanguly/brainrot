# 🧠 BrainRot - Digital Wellness & Focus Management App

A React Native (Expo) application designed to help users manage their digital wellness by tracking app usage, providing intelligent blocking features, and calculating a "Brain Score" based on usage patterns.

## 📱 Features

### Core Functionality
- **Real-time App Usage Tracking** - Monitor time spent in different apps
- **Brain Score System** - Dynamic scoring system (0-100) based on usage patterns
- **Smart App Blocking** - Soft and hard blocking modes with customizable bypass limits
- **Usage Notifications** - Progressive alerts at 30min, 45min, 1hr, 1.5hr, 2hr thresholds
- **Floating Score Display** - Real-time brain score overlay while using monitored apps
- **Historical Data Analysis** - Track usage patterns over 90 days
- **Daily Reset System** - Automatic midnight reset of trackers and bypass counts

### Blocking Modes
- **Soft Block**: Shows warning overlay with dismiss option, displays floating brain score
- **Hard Block**: Full-screen blocking overlay, requires returning to home or BrainRot app
- **Schedule-based Blocking**: Set time windows for automatic hard blocking
- **Bypass System**: Limited daily bypasses (default: 3) with brain score context

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React Native with Expo
- **Language**: TypeScript + Kotlin (native modules)
- **Database**: SQLite (expo-sqlite)
- **Native Integration**: Custom Kotlin modules for Android system APIs
- **State Management**: React hooks + singleton services

### Project Structure
```
brainrot/
├── app/                    # Main app screens (Expo Router)
│   ├── (tabs)/            # Tab navigation screens
│   │   ├── index.tsx      # Home screen
│   │   └── settings.tsx   # Settings screen
├── components/            # Reusable UI components
├── services/              # Business logic services
│   ├── AppBlockingService.tsx     # App blocking logic
│   ├── UnifiedUsageService.ts     # Consolidated usage tracking
│   ├── ServiceCoordinator.ts      # Service orchestration
│   ├── database.ts               # SQLite operations
│   └── NotificationService.ts    # Push notifications
├── utils/                 # Utility functions
├── android/              # Native Android code
│   └── app/src/main/java/com/soumikganguly/brainrot/
│       ├── UsageStatsModule.kt        # Usage stats access
│       ├── BlockingOverlayService.kt   # Overlay UI service
│       └── FloatingScoreService.kt    # Floating window service
└── babel.config.js       # Expo/Babel configuration
```

## 🚀 Setup & Installation

### Prerequisites
- Node.js 18+
- Android Studio (for Android development)
- Expo CLI (`npm install -g expo-cli`)

### Installation Steps
```bash
# Clone repository
git clone https://github.com/yourusername/brainrot.git
cd brainrot

# Install dependencies
npm install

# For iOS (if applicable)
cd ios && pod install && cd ..

# Start development server
npx expo start
```

### Android Permissions Required
The app requires these permissions (automatically requested):
- `PACKAGE_USAGE_STATS` - Access app usage statistics
- `SYSTEM_ALERT_WINDOW` - Display overlay windows
- `POST_NOTIFICATIONS` - Send usage notifications
- `FOREGROUND_SERVICE` - Run monitoring in background

## 🔧 Key Issues & Solutions

### 1. Service Overlap Resolution
**Problem**: `UsageService.ts` and `UsageMonitoringService.ts` had overlapping functionality

**Solution**: Created `UnifiedUsageService.ts` that consolidates:
- Usage data retrieval
- Real-time monitoring
- Notification thresholds
- Blocking overlay triggers
- Permission management

**Migration Steps**:
1. Replace all imports of `UsageService` and `UsageMonitoringService` with `UnifiedUsageService`
2. Update service initialization in `app/(tabs)/index.tsx`
3. Update `ServiceCoordinator.ts` to use unified service

### 2. Blocking Overlay Not Working
**Problems Identified**:
- Missing foreground service for Android 8+
- Incorrect overlay window flags
- No UI interaction handlers
- Missing notification channel

**Solution**: Updated `BlockingOverlayService.kt` with:
- Proper foreground service implementation
- Correct `TYPE_APPLICATION_OVERLAY` for modern Android
- Interactive buttons for navigation
- Visual differentiation between soft/hard blocks

### 3. App Screen Updates Required
After merging services, update these screens:

**Home Screen (`index.tsx`)**:
```typescript
// Replace
import { UsageMonitoringService } from '@/services/UsageMonitoringService';
import { UsageService } from '@/services/UsageService';

// With
import { UnifiedUsageService } from '@/services/UnifiedUsageService';

// Update initialization
const unifiedService = UnifiedUsageService.getInstance();
await unifiedService.initialize();
```

**Settings Screen (`settings.tsx`)**:
```typescript
// Update monitoring toggle
const handleMonitoringToggle = async (enabled: boolean) => {
  const service = UnifiedUsageService.getInstance();
  if (enabled) {
    await service.startMonitoring();
  } else {
    await service.stopMonitoring();
  }
};
```

## 🐛 Known Issues & Fixes

### Issue: Overlay Permission Not Working
**Symptoms**: Blocking overlay doesn't appear even with permission granted

**Fix Applied**:
- Added foreground service with notification
- Updated manifest with proper service declaration
- Implemented correct WindowManager.LayoutParams flags

### Issue: Duplicate Service Functionality
**Symptoms**: Conflicting monitoring logic, redundant API calls

**Fix Applied**:
- Consolidated into UnifiedUsageService
- Single source of truth for usage data
- Coordinated notification and blocking triggers

### Issue: Native Module Crash
**Symptoms**: App crashes when accessing usage stats

**Fix Applied**:
- Added null safety checks in Kotlin modules
- Proper exception handling
- Graceful fallback for missing permissions

## 📊 Brain Score Algorithm

The Brain Score (0-100) is calculated based on:
- Total screen time vs. allowed daily limit (default: 8 hours)
- Time spent in monitored "brain rot" apps
- Progressive penalty for extended usage
- Bonus points for taking breaks

Formula:
```typescript
baseScore = 100 * (1 - (usageMs / allowedMs))
penalty = Math.min(30, monitoredUsageHours * 10)
finalScore = Math.max(0, Math.min(100, baseScore - penalty))
```

## 🔄 Service Architecture Flow

1. **App Launch** → Initialize services
2. **UnifiedUsageService** → Starts monitoring
3. **Native Module** → Detects app changes
4. **ServiceCoordinator** → Routes to appropriate handler
5. **AppBlockingService** → Checks if app should be blocked
6. **BlockingOverlayService** → Shows blocking UI if needed
7. **User Interaction** → Bypass or return home
8. **Database** → Records usage and bypass data

## 🛠️ Development Commands

```bash
# Run on Android
npx expo run:android

# Build APK
eas build -p android --profile preview

# Clear cache
npx expo start -c

# Run with logs
npx react-native log-android
```

## 📝 Configuration

### Customizable Settings
- **Monitoring Interval**: 30 seconds (default)
- **Notification Thresholds**: 30, 45, 60, 90, 120 minutes
- **Bypass Limit**: 3 per day
- **Block Modes**: Soft (warning) or Hard (full block)
- **Daily Reset Time**: Midnight local time

### Database Schema
```sql
-- App usage tracking
CREATE TABLE usage_data (
  id INTEGER PRIMARY KEY,
  packageName TEXT,
  appName TEXT,
  totalTimeMs INTEGER,
  date TEXT,
  UNIQUE(packageName, date)
);

-- Metadata storage
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## 🚦 Testing

### Manual Testing Checklist
- [ ] Usage permission granted and working
- [ ] Overlay permission granted and working
- [ ] Notifications appear at thresholds
- [ ] Soft block shows floating score
- [ ] Hard block prevents app access
- [ ] Bypass counter works correctly
- [ ] Daily reset at midnight
- [ ] Brain score updates accurately

### Debug Features
Located in Settings screen:
- Test overlay permission
- Trigger manual usage check
- Test floating score window
- Reset trial period
- View service status

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - See LICENSE file for details

## 👥 Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/yourusername/brainrot/issues)
- Email: support@brainrot.app

## 🔮 Future Enhancements

- [ ] iOS support with ScreenTime API
- [ ] Cloud sync for multiple devices
- [ ] Detailed analytics dashboard
- [ ] Gamification with achievements
- [ ] Focus mode scheduling
- [ ] App usage predictions with ML
- [ ] Widget for quick score viewing
- [ ] Integration with other wellness apps
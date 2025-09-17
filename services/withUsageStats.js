const { withAndroidManifest } = require('@expo/config-plugins');

const withUsageStats = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    
    // Add tools namespace if not present
    if (!androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Ensure uses-permission array exists
    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }

    // Check if PACKAGE_USAGE_STATS permission already exists
    const hasUsageStatsPermission = androidManifest.manifest['uses-permission'].some(
      permission => 
        permission.$['android:name'] === 'android.permission.PACKAGE_USAGE_STATS'
    );

    // Add or update the usage stats permission with tools:ignore
    if (hasUsageStatsPermission) {
      // Update existing permission to include tools:ignore
      androidManifest.manifest['uses-permission'].forEach(permission => {
        if (permission.$['android:name'] === 'android.permission.PACKAGE_USAGE_STATS') {
          permission.$['tools:ignore'] = 'ProtectedPermissions';
        }
      });
    } else {
      // Add new permission with tools:ignore
      androidManifest.manifest['uses-permission'].push({
        $: {
          'android:name': 'android.permission.PACKAGE_USAGE_STATS',
          'tools:ignore': 'ProtectedPermissions'
        }
      });
    }

    // Add queries if not present (for opening settings)
    if (!androidManifest.manifest.queries) {
      androidManifest.manifest.queries = [];
    }

    // Check if usage access settings query already exists
    const hasUsageQuery = androidManifest.manifest.queries.some(query => 
      query.intent && 
      query.intent.some(intent => 
        intent.action && 
        intent.action.some(action => 
          action.$['android:name'] === 'android.settings.USAGE_ACCESS_SETTINGS'
        )
      )
    );

    if (!hasUsageQuery) {
      androidManifest.manifest.queries.push({
        intent: [
          {
            action: [
              {
                $: {
                  'android:name': 'android.settings.USAGE_ACCESS_SETTINGS'
                }
              }
            ]
          }
        ]
      });
    }

    return config;
  });
};

module.exports = withUsageStats;
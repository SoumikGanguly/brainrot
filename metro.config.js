const { withNativeWind } = require('nativewind/metro');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");
 
const config = getSentryExpoConfig(__dirname)
config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

config.resolver.platforms = ['ios', 'android', 'native', 'web'];
 
module.exports = withNativeWind(config, { input: './global.css' })
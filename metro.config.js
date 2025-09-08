const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');
 
const config = getDefaultConfig(__dirname)
config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

config.resolver.platforms = ['ios', 'android', 'native', 'web'];
 
module.exports = withNativeWind(config, { input: './global.css' })
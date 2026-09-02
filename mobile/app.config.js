const googlePlugin = '@react-native-google-signin/google-signin';
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const iosUrlScheme = iosClientId?.endsWith('.apps.googleusercontent.com')
  ? `com.googleusercontent.apps.${iosClientId.slice(0, -'.apps.googleusercontent.com'.length)}`
  : undefined;

module.exports = ({ config }) => ({
  ...config,
  plugins: config.plugins.map(plugin => plugin === googlePlugin && iosUrlScheme
      ? [googlePlugin, { iosUrlScheme }]
      : plugin),
});

// Expo + React Native Babel config.
// `babel-preset-expo` handles JSX/TS and expo-router. The Reanimated plugin MUST
// be listed last (it rewrites worklets and expects to run after everything else).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};

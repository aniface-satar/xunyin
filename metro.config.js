const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const exclusionList = require('metro-config/src/defaults/exclusionList')

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Exclude nested reference copies / sync-server checkouts (they contain
    // their own node_modules) so Metro's crawler doesn't traverse them.
    blockList: exclusionList([
      /[/\\]lx-music-mobile[/\\].*/,
      /[/\\]lx-music-sync-server[/\\].*/,
    ]),
    extraNodeModules: {
      // crypto: require.resolve('react-native-quick-crypto'),
      // stream: require.resolve('stream-browserify'),
      buffer: require.resolve('@craftzdog/react-native-buffer'),
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)

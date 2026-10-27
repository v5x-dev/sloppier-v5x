const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// Yjs draws client IDs through lib0/webcrypto. On native, that module pulls in
// isomorphic-webcrypto's native stack, so route it to expo-crypto instead.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lib0/webcrypto' && platform !== 'web') {
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'lib', 'lib0-webcrypto.ts'),
    };
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});

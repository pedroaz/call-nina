const { getDefaultConfig } = require("expo/metro-config");
const {
  clientConfigurationPath,
  requireClientConfiguration,
} = require("../../scripts/lib/hosting-environment.mjs");

requireClientConfiguration();
const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "./nina-public.json" &&
    /[\\/]packages[\\/]contracts[\\/](?:src|dist)[\\/]nina-account\.js$/.test(
      context.originModulePath,
    )
  )
    return { type: "sourceFile", filePath: clientConfigurationPath() };
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;

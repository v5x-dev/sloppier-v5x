const { withPodfile, withAppBuildGradle } = require('@expo/config-plugins');

// STTextView is SPM-only. Link it through React Native's built-in
// `spm_dependency` support (see the podspec's RNSE_USE_RN_SPM branch).
// The cocoapods-spm plugin is avoided: its post-integrate hook rewrites
// OTHER_SWIFT_FLAGS and drops Expo's `-load-plugin-executable` flag for
// ExpoModulesMacros, which breaks Expo SDK 58 modules.
const RN_SPM_LINE = `ENV['RNSE_USE_RN_SPM'] = '1'`;

function injectRnSpmFlag(contents) {
  if (contents.includes(RN_SPM_LINE)) return contents;
  const requireBlock = contents.match(/^(require File\.join.*\n)+/m);
  const line = `\n# react-native-source-editor: link STTextView via React Native SPM.\n${RN_SPM_LINE}\n`;
  if (requireBlock) {
    const insertAt = requireBlock.index + requireBlock[0].length;
    return contents.slice(0, insertAt) + line + contents.slice(insertAt);
  }
  return `${line}\n${contents}`;
}

// Sora-Editor's `language-textmate` AAR declares it requires core library
// desugaring (it pulls in joni, which uses java.time on minSdk < 26).
// The consuming app must enable it; we inject the Gradle setting + dep
// here so consumers don't have to hand-edit android/app/build.gradle.
const DESUGAR_DEP =
  "coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'";
const DESUGAR_MARKER = 'desugar_jdk_libs';

function injectCoreLibraryDesugaring(contents) {
  if (contents.includes(DESUGAR_MARKER)) return contents;

  // Add `coreLibraryDesugaringEnabled true` to the existing
  // `compileOptions { ... }` block, or create the block if absent.
  const compileOptionsMatch = contents.match(
    /compileOptions\s*\{([\s\S]*?)\n\s*\}/
  );
  if (compileOptionsMatch) {
    const inner = compileOptionsMatch[1];
    if (!inner.includes('coreLibraryDesugaringEnabled')) {
      contents = contents.replace(
        compileOptionsMatch[0],
        compileOptionsMatch[0].replace(
          inner,
          `${inner}\n        coreLibraryDesugaringEnabled true`
        )
      );
    }
  } else {
    // No compileOptions block — drop one in just after the `android {` line.
    contents = contents.replace(
      /android\s*\{/,
      `android {\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }`
    );
  }

  // Append the desugar_jdk_libs dep to the existing top-level
  // `dependencies { ... }` block.
  const depsMatch = contents.match(/\ndependencies\s*\{([\s\S]*?)\n\}/);
  if (!depsMatch) {
    throw new Error(
      "[react-native-source-editor] Could not find `dependencies { ... }` in app/build.gradle to anchor the desugar_jdk_libs dep."
    );
  }
  return contents.replace(
    depsMatch[0],
    depsMatch[0].replace(/\n\}$/, `\n    ${DESUGAR_DEP}\n}`)
  );
}

const withSourceEditor = (config) => {
  config = withPodfile(config, (config) => {
    config.modResults.contents = injectRnSpmFlag(config.modResults.contents);
    return config;
  });
  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config;
    config.modResults.contents = injectCoreLibraryDesugaring(
      config.modResults.contents
    );
    return config;
  });
  return config;
};

module.exports = withSourceEditor;
module.exports.default = withSourceEditor;

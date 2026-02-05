const { withAppBuildGradle } = require("@expo/config-plugins");

const DEPENDENCIES = [
  '    implementation "androidx.work:work-runtime-ktx:2.8.1"',
  '    implementation "androidx.work:work-runtime:2.8.1"',
  '    implementation "androidx.core:core-ktx:1.10.1"',
  '    implementation "androidx.lifecycle:lifecycle-runtime-ktx:2.6.1"',
  '    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.1"',
  '    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.1"',
];

function ensureDeps(contents) {
  if (!contents.includes("dependencies {")) {
    return contents;
  }

  const alreadyHasAll = DEPENDENCIES.every((dep) => contents.includes(dep));
  if (alreadyHasAll) {
    return contents;
  }

  const lines = contents.split("\n");
  const out = [];
  let inDependencies = false;
  let injected = false;

  for (const line of lines) {
    out.push(line);

    if (!inDependencies && line.trim() === "dependencies {") {
      inDependencies = true;
      continue;
    }

    if (inDependencies && !injected && line.trim() === "}") {
      for (const dep of DEPENDENCIES) {
        if (!contents.includes(dep)) {
          out.push(dep);
        }
      }
      injected = true;
      inDependencies = false;
    }
  }

  return out.join("\n");
}

module.exports = function withAndroidDeps(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults?.contents) {
      config.modResults.contents = ensureDeps(config.modResults.contents);
    }
    return config;
  });
};

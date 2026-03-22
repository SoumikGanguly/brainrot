const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withPlugins,
} = require("@expo/config-plugins");

const TEMPLATE_PACKAGE = "com.soumikganguly.brainrot";
const NATIVE_TEMPLATE_ROOT = path.join(
  __dirname,
  "brainrot-android",
  "templates",
  "src",
  "main"
);

const ADDITIONAL_DEPENDENCIES = [
  '    implementation "androidx.work:work-runtime-ktx:2.8.1"',
  '    implementation "androidx.work:work-runtime:2.8.1"',
  '    implementation "androidx.core:core-ktx:1.10.1"',
  '    implementation "androidx.lifecycle:lifecycle-runtime-ktx:2.6.1"',
  '    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.1"',
  '    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.1"',
];

const REQUIRED_PERMISSIONS = [
  { "android:name": "android.permission.FOREGROUND_SERVICE", __nodeKey: "android.permission.FOREGROUND_SERVICE" },
  { "android:name": "android.permission.FOREGROUND_SERVICE_SPECIAL_USE", __nodeKey: "android.permission.FOREGROUND_SERVICE_SPECIAL_USE" },
  {
    "android:name": "android.permission.PACKAGE_USAGE_STATS",
    "tools:ignore": "ProtectedPermissions",
    __nodeKey: "android.permission.PACKAGE_USAGE_STATS",
  },
  { "android:name": "android.permission.POST_NOTIFICATIONS", __nodeKey: "android.permission.POST_NOTIFICATIONS" },
  { "android:name": "android.permission.SYSTEM_ALERT_WINDOW", __nodeKey: "android.permission.SYSTEM_ALERT_WINDOW" },
  { "android:name": "android.permission.VIBRATE", __nodeKey: "android.permission.VIBRATE" },
  { "android:name": "android.permission.WAKE_LOCK", __nodeKey: "android.permission.WAKE_LOCK" },
  { "android:name": "android.permission.RECEIVE_BOOT_COMPLETED", __nodeKey: "android.permission.RECEIVE_BOOT_COMPLETED" },
  {
    "android:name": "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    __nodeKey: "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
  },
];

const QUERY_PACKAGES = [
  "com.google.android.youtube",
  "com.instagram.android",
  "com.zhiliaoapp.musically",
  "com.ss.android.ugc.tiktok",
  "com.facebook.katana",
  "com.twitter.android",
  "com.reddit.frontpage",
  "com.snapchat.android",
  "com.netflix.mediaclient",
  "com.whatsapp",
  "com.discord",
  "com.spotify.music",
  "com.pinterest",
  "com.linkedin.android",
  "tv.twitch.android.app",
];

const QUERY_INTENTS = [
  {
    action: "android.intent.action.VIEW",
    categories: ["android.intent.category.BROWSABLE"],
    data: [{ "android:scheme": "https" }],
  },
  {
    action: "android.settings.USAGE_ACCESS_SETTINGS",
  },
  {
    action: "android.intent.action.MAIN",
    categories: ["android.intent.category.LAUNCHER"],
  },
];

const SERVICES = [
  {
    $: {
      "android:name": ".BlockingOverlayService",
      "android:enabled": "true",
      "android:exported": "false",
      "android:stopWithTask": "false",
      "android:foregroundServiceType": "specialUse",
    },
    property: [
      {
        $: {
          "android:name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
          "android:value":
            "Display app blocking overlay for digital wellness monitoring and intervention",
        },
      },
    ],
  },
  {
    $: {
      "android:name": ".FloatingScoreService",
      "android:enabled": "true",
      "android:exported": "false",
      "android:stopWithTask": "true",
      "android:foregroundServiceType": "specialUse",
    },
    property: [
      {
        $: {
          "android:name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
          "android:value": "Display brain score floating widget during app usage",
        },
      },
    ],
  },
  {
    $: {
      "android:name": ".ForegroundMonitoringService",
      "android:enabled": "true",
      "android:exported": "false",
      "android:stopWithTask": "false",
      "android:foregroundServiceType": "dataSync",
    },
  },
  {
    $: {
      "android:name": ".BrainrotAccessibilityService",
      "android:enabled": "true",
      "android:exported": "false",
      "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
    },
    "intent-filter": [
      {
        action: [
          {
            $: {
              "android:name": "android.accessibilityservice.AccessibilityService",
            },
          },
        ],
      },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.accessibilityservice",
          "android:resource": "@xml/brainrot_accessibility_service",
        },
      },
    ],
  },
];

const PROVIDER = {
  $: {
    "android:name": "androidx.startup.InitializationProvider",
    "android:authorities": "${applicationId}.androidx-startup",
    "android:exported": "false",
    "tools:node": "merge",
  },
  "meta-data": [
    {
      $: {
        "android:name": "androidx.work.WorkManagerInitializer",
        "android:value": "androidx.startup",
        "tools:node": "remove",
      },
    },
  ],
};

function ensureDeps(contents) {
  if (!contents.includes("dependencies {")) {
    return contents;
  }

  const alreadyHasAll = ADDITIONAL_DEPENDENCIES.every((dep) => contents.includes(dep));
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
      for (const dep of ADDITIONAL_DEPENDENCIES) {
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

function ensureHermesCompilerPath(contents) {
  if (contents.includes("def hermesCompilerPackage")) {
    return contents;
  }

  const lines = contents.split("\n");
  const hermesLineIndex = lines.findIndex(
    (line) =>
      line.includes("hermesCommand =") &&
      line.includes("/sdks/hermesc/%OS-BIN%/hermesc")
  );

  if (hermesLineIndex === -1) {
    return contents;
  }

  const indentation = lines[hermesLineIndex].match(/^\s*/)?.[0] ?? "    ";
  lines.splice(
    hermesLineIndex,
    1,
    `${indentation}def hermesCompilerPackage = ["node", "--print", "try { require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] }) } catch (e) { '' }"].execute(null, rootDir).text.trim()`,
    `${indentation}hermesCommand = hermesCompilerPackage`,
    `${indentation}    ? new File(hermesCompilerPackage).getParentFile().getAbsolutePath() + "/hermesc/%OS-BIN%/hermesc"`,
    `${indentation}    : reactNativeDir.getAbsolutePath() + "/sdks/hermesc/%OS-BIN%/hermesc"`
  );

  return lines.join("\n");
}

function withBrainrotBuildGradle(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults?.contents) {
      config.modResults.contents = ensureDeps(
        ensureHermesCompilerPath(config.modResults.contents)
      );
    }
    return config;
  });
}

function ensureNamedItem(items, item) {
  const existing = items ?? [];
  const key = item.$["android:name"];
  return [...existing.filter((entry) => entry?.$?.["android:name"] !== key), item];
}

function ensurePermission(manifest, attrs) {
  const existing = manifest.manifest["uses-permission"] ?? [];
  const name = attrs.__nodeKey;
  const item = { $: Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "__nodeKey")) };
  manifest.manifest["uses-permission"] = [
    ...existing.filter((entry) => entry?.$?.["android:name"] !== name),
    item,
  ];
}

function ensureQueryIntent(queries, queryIntent) {
  const intents = queries.intent ?? [];
  const key = JSON.stringify(queryIntent);
  const nextIntent = {
    action: [{ $: { "android:name": queryIntent.action } }],
  };

  if (queryIntent.categories?.length) {
    nextIntent.category = queryIntent.categories.map((category) => ({
      $: { "android:name": category },
    }));
  }

  if (queryIntent.data?.length) {
    nextIntent.data = queryIntent.data.map((data) => ({ $: data }));
  }

  queries.intent = [
    ...intents.filter((entry) => JSON.stringify(normalizeQueryIntent(entry)) !== key),
    nextIntent,
  ];
}

function normalizeQueryIntent(intent) {
  return {
    action: intent?.action?.[0]?.$?.["android:name"],
    categories: (intent?.category ?? []).map((entry) => entry.$["android:name"]),
    data: (intent?.data ?? []).map((entry) => entry.$),
  };
}

function withBrainrotManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    for (const permission of REQUIRED_PERMISSIONS) {
      ensurePermission(manifest, permission);
    }

    manifest.manifest.queries = manifest.manifest.queries ?? [{}];
    const queries = manifest.manifest.queries[0];
    queries.package = queries.package ?? [];
    queries.package = [
      ...queries.package.filter(
        (entry) => !QUERY_PACKAGES.includes(entry?.$?.["android:name"])
      ),
      ...QUERY_PACKAGES.map((pkg) => ({ $: { "android:name": pkg } })),
    ];

    for (const queryIntent of QUERY_INTENTS) {
      ensureQueryIntent(queries, queryIntent);
    }

    mainApplication.$["android:name"] = ".MainApplication";
    mainApplication.service = mainApplication.service ?? [];
    for (const service of SERVICES) {
      mainApplication.service = ensureNamedItem(mainApplication.service, service);
    }

    mainApplication.provider = ensureNamedItem(mainApplication.provider, PROVIDER);

    config.modResults = manifest;
    return config;
  });
}

async function copyDirectory(sourceDir, destinationDir, packageName) {
  await fs.promises.mkdir(destinationDir, { recursive: true });
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, packageName);
      continue;
    }

    const contents = await fs.promises.readFile(sourcePath, "utf8");
    await fs.promises.writeFile(
      destinationPath,
      contents.replaceAll(TEMPLATE_PACKAGE, packageName),
      "utf8"
    );
  }
}

function withBrainrotNativeSources(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const packageName = config.android?.package;
      if (!packageName) {
        throw new Error("android.package must be set in app config for withBrainrotAndroid");
      }

      const projectRoot = config.modRequest.projectRoot;
      const sourceRoot = path.join(projectRoot, "android", "app", "src", "main");
      const javaDestination = path.join(
        sourceRoot,
        "java",
        ...packageName.split(".")
      );

      await copyDirectory(
        path.join(NATIVE_TEMPLATE_ROOT, "java", ...TEMPLATE_PACKAGE.split(".")),
        javaDestination,
        packageName
      );

      for (const resourceDir of ["xml", "layout", "drawable"]) {
        await copyDirectory(
          path.join(NATIVE_TEMPLATE_ROOT, "res", resourceDir),
          path.join(sourceRoot, "res", resourceDir),
          packageName
        );
      }

      return config;
    },
  ]);
}

function withBrainrotAndroid(config) {
  return withPlugins(config, [
    withBrainrotBuildGradle,
    withBrainrotManifest,
    withBrainrotNativeSources,
  ]);
}

module.exports = withBrainrotAndroid;

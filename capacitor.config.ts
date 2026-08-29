import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eboncrucible.arena',
  appName: 'Ebon Crucible',
  webDir: 'dist-mobile',
  server: {
    url: 'https://eboncrucible.com/play/',
    cleartext: false,
    allowNavigation: ['eboncrucible.com', '*.stripe.com'],
  },
  android: {
    buildOptions: {
      releaseType: 'AAB',
    },
  },
  ios: {
    scheme: 'Ebon Crucible',
  },
};

export default config;

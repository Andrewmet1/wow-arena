/**
 * Platform detection — identifies runtime environment.
 * Used for conditional behavior (payment routing, fullscreen, deep links).
 */
export const Platform = {
  get isElectron() {
    return !!(window.electronBridge?.isElectron);
  },
  get isCapacitor() {
    return !!(window.Capacitor?.isNativePlatform?.());
  },
  get isMobileApp() {
    return this.isCapacitor;
  },
  get isDesktopApp() {
    return this.isElectron;
  },
  get isWeb() {
    return !this.isElectron && !this.isCapacitor;
  },
  get isPWA() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  },
  get isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  get isIOSApp() {
    return this.isCapacitor && this.isIOS;
  },
  get canPurchase() {
    // Purchases only on web — iOS blocked by Apple policy, Steam requires Steam Wallet
    return !this.isIOSApp && !this.isElectron;
  },
};

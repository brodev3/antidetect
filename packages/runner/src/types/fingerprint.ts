export interface FingerprintOptions {
  emulateDeviceScaleFactor?: boolean;
  emulateSensorAPI?: boolean;
  usePerfectCanvas?: boolean;
  useFontPack?: boolean;
  safeElementSize?: boolean;
  safeBattery?: boolean;
  safeCanvas?: boolean;
  safeAudio?: boolean;
  safeWebGL?: boolean;
}

export type Time = '*' | '15 days' | '30 days' | '60 days';

export type Tag =
  | '*'
  | 'Desktop'
  | 'Mobile'
  | 'Microsoft Windows'
  | 'Apple Mac'
  | 'Android'
  | 'Linux'
  | 'iPad'
  | 'iPhone'
  | 'Edge'
  | 'Chrome'
  | 'Safari'
  | 'Firefox'
  | 'YaBrowser'
  | 'Windows 7'
  | 'Windows 8'
  | 'Windows 10';

export interface FetchOptions {
  tags?: Tag[];
  timeLimit?: Time;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minBrowserVersion?: number | 'current';
  maxBrowserVersion?: number | 'current';
  perfectCanvasLogs?: boolean;
  perfectCanvasRequest?: string;
  enableCustomServer?: boolean;
  dynamicPerfectCanvas?: boolean;
  enablePrecomputedFingerprints?: boolean;
}

export type FingerprintFetchOptions = FetchOptions;




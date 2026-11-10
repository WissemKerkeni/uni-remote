// App domain model. Persisted in AsyncStorage and in export files.

/** A fixed-code OOK signal that rc-switch can decode and re-send. */
export interface RfSignal {
  protocol: number; // rc-switch protocol number 1..12
  protocolName?: string;
  bitLength: number; // 1..32
  value: string; // decimal string (avoids JS number pitfalls, future 64-bit)
  pulseLength: number; // microseconds (0 = protocol default)
  repeat: number; // frames per transmission
}

/** A signal captured during a learning session (not yet saved). */
export interface Capture {
  id: string;
  signal: RfSignal;
  frames: number;
  durationMs: number;
  decoded: { hex: string; binary: string; triState?: string };
  frequencyMHz: number;
  frequencySource: 'nominal' | 'measured';
  modulation: string;
  timings?: number[];
  receivedAt: number;
}

/** A signal the user saved to the library after confirming authorization. */
export interface SavedSignal {
  id: string;
  name: string;
  signal: RfSignal;
  createdAt: number;
}

/**
 * How a remote is drawn.
 *  - grid2 / grid3 / list : legacy fixed grids (still supported)
 *  - custom               : free grid, `columns` + per-button span/shape/kind
 *  - keyfob               : buttons drawn on a key-fob body (round buttons)
 *  - climate              : climate panel; buttons placed by `role`
 */
export type RemoteLayout = 'grid2' | 'grid3' | 'list' | 'custom' | 'keyfob' | 'climate';

export const REMOTE_LAYOUTS: { id: RemoteLayout; label: string }[] = [
  { id: 'custom', label: 'Custom grid' },
  { id: 'grid2', label: '2 columns' },
  { id: 'grid3', label: '3 columns' },
  { id: 'list', label: 'List' },
  { id: 'keyfob', label: 'Key fob' },
  { id: 'climate', label: 'Climate' },
];

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 5;

export const REMOTE_CATEGORIES = [
  'Lights',
  'Outlets',
  'Fan',
  'Blinds',
  'Doorbell',
  'Gate (fixed-code)',
  'Key fob',
  'Climate',
  'Other',
] as const;
export type RemoteCategory = (typeof REMOTE_CATEGORIES)[number];

export const BUTTON_COLORS = ['slate', 'mint', 'blue', 'amber', 'red', 'violet'] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

export const BUTTON_ICONS = [
  'power',
  'bulb',
  'bulb-outline',
  'flash',
  'sunny',
  'moon',
  'add',
  'remove',
  'chevron-up',
  'chevron-down',
  'play',
  'stop',
  'pause',
  'notifications',
  'lock-closed',
  'lock-open',
  'home',
  'radio-button-on',
  'thermometer',
  'snow',
  'flame',
  'water',
  'leaf',
  'speedometer',
  'swap-vertical',
  'timer',
  'car',
  'key',
  'cube',
  'arrow-up',
  'arrow-down',
  'arrow-back',
  'arrow-forward',
  'ellipse',
  'sparkles',
  'tv',
  'volume-high',
  'volume-low',
  'contrast',
] as const;
export type ButtonIcon = (typeof BUTTON_ICONS)[number];

export const BUTTON_SHAPES = ['rounded', 'circle', 'pill'] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

/** Semantic role, used by the key-fob and climate layouts to place buttons. */
export const BUTTON_ROLES = [
  'power',
  'lock',
  'unlock',
  'trunk',
  'panic',
  'aux',
  'temp_up',
  'temp_down',
  'mode',
  'fan',
  'swing',
  'timer',
  'sleep',
  'eco',
] as const;
export type ButtonRole = (typeof BUTTON_ROLES)[number];

/** button = transmits; label = section heading; spacer = empty cell (custom grid). */
export type ButtonKind = 'button' | 'label' | 'spacer';

export interface RemoteButton {
  id: string;
  label: string;
  color: ButtonColor;
  icon?: ButtonIcon;
  signal?: RfSignal;
  kind?: ButtonKind; // default 'button'
  span?: number; // columns occupied in the custom grid (default 1)
  shape?: ButtonShape; // default 'rounded'
  role?: ButtonRole;
}

export interface Remote {
  id: string;
  name: string;
  category: RemoteCategory;
  layout: RemoteLayout;
  columns?: number; // custom layout only (1..5, default 3)
  buttons: RemoteButton[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

// Ready-made remote layouts. Every template is plain data (layout + buttons),
// so a created remote is fully editable afterwards and exports like any other.
import type { ButtonColor, ButtonIcon, ButtonRole, ButtonShape, ButtonKind, RemoteButton, RemoteCategory, RemoteLayout } from './types';

export type TemplateButton = Omit<RemoteButton, 'id'>;

export interface RemoteTemplate {
  id: string;
  title: string;
  description: string;
  category: RemoteCategory;
  layout: RemoteLayout;
  columns?: number;
  /** Shown as a caveat chip in the picker. */
  note?: string;
  buttons: TemplateButton[];
}

const b = (
  label: string,
  color: ButtonColor,
  icon?: ButtonIcon,
  opts: { span?: number; shape?: ButtonShape; role?: ButtonRole; kind?: ButtonKind } = {},
): TemplateButton => ({ label, color, icon, ...opts });

const heading = (label: string, span: number): TemplateButton => ({ label, color: 'slate', kind: 'label', span });

export const TEMPLATES: RemoteTemplate[] = [
  {
    id: 'general4',
    title: 'General – 4 channel',
    description: 'A–D channels with ON / OFF each, plus all on / all off. Fits most RF socket and switch sets.',
    category: 'Outlets',
    layout: 'custom',
    columns: 2,
    buttons: [
      ...(['A', 'B', 'C', 'D'] as const).flatMap((ch) => [
        b(`${ch} ON`, 'mint', 'power', { shape: 'pill' }),
        b(`${ch} OFF`, 'slate', 'power', { shape: 'pill' }),
      ]),
      b('All ON', 'mint', 'flash', { span: 1 }),
      b('All OFF', 'red', 'flash', { span: 1 }),
    ],
  },
  {
    id: 'onoff',
    title: 'Simple On / Off',
    description: 'Two big buttons for a single socket, lamp or relay.',
    category: 'Lights',
    layout: 'custom',
    columns: 2,
    buttons: [b('On', 'mint', 'power'), b('Off', 'red', 'power')],
  },
  {
    id: 'light',
    title: 'Light & dimmer',
    description: 'Power, brightness up/down and three scene buttons.',
    category: 'Lights',
    layout: 'custom',
    columns: 3,
    buttons: [
      b('Power', 'mint', 'power', { span: 3, shape: 'pill' }),
      b('Brighter', 'amber', 'sunny'),
      b('Night', 'violet', 'moon'),
      b('Dimmer', 'slate', 'contrast'),
      heading('Scenes', 3),
      b('Scene 1', 'blue', 'sparkles', { shape: 'circle' }),
      b('Scene 2', 'blue', 'sparkles', { shape: 'circle' }),
      b('Scene 3', 'blue', 'sparkles', { shape: 'circle' }),
    ],
  },
  {
    id: 'media',
    title: 'General – media style',
    description: 'Power, up/down/left/right, OK and volume rocker for RF media or projector screens.',
    category: 'Other',
    layout: 'custom',
    columns: 3,
    buttons: [
      b('Power', 'red', 'power', { shape: 'circle' }),
      { label: '', color: 'slate', kind: 'spacer' },
      b('Mode', 'slate', 'ellipse', { shape: 'circle' }),
      { label: '', color: 'slate', kind: 'spacer' },
      b('Up', 'slate', 'chevron-up'),
      { label: '', color: 'slate', kind: 'spacer' },
      b('Left', 'slate', 'arrow-back'),
      b('OK', 'mint', 'radio-button-on', { shape: 'circle' }),
      b('Right', 'slate', 'arrow-forward'),
      { label: '', color: 'slate', kind: 'spacer' },
      b('Down', 'slate', 'chevron-down'),
      { label: '', color: 'slate', kind: 'spacer' },
      b('Vol −', 'slate', 'volume-low', { shape: 'pill' }),
      b('Mute', 'slate', 'remove', { shape: 'pill' }),
      b('Vol +', 'slate', 'volume-high', { shape: 'pill' }),
    ],
  },
  {
    id: 'blinds',
    title: 'Blinds / gate',
    description: 'Up, stop and down – for motorised blinds, awnings and fixed-code gates.',
    category: 'Blinds',
    layout: 'custom',
    columns: 1,
    buttons: [b('Up', 'blue', 'chevron-up', { shape: 'pill' }), b('Stop', 'amber', 'stop', { shape: 'pill' }), b('Down', 'blue', 'chevron-down', { shape: 'pill' })],
  },
  {
    id: 'keyfob',
    title: 'Key fob',
    description: 'Lock, unlock, trunk/aux and panic on a fob-shaped remote.',
    category: 'Key fob',
    layout: 'keyfob',
    note: 'Fixed-code fobs only – car keys use rolling codes and cannot be learned',
    buttons: [
      b('Lock', 'red', 'lock-closed', { role: 'lock', shape: 'circle' }),
      b('Unlock', 'mint', 'lock-open', { role: 'unlock', shape: 'circle' }),
      b('Trunk', 'blue', 'cube', { role: 'trunk', shape: 'circle' }),
      b('Panic', 'amber', 'notifications', { role: 'panic', shape: 'circle' }),
    ],
  },
  {
    id: 'climate',
    title: 'Climate',
    description: 'Power, mode, temperature rocker, fan speed, swing, timer, sleep and eco.',
    category: 'Climate',
    layout: 'climate',
    note: 'For 433 MHz fans and heaters – most A/C units use infrared',
    buttons: [
      b('Power', 'red', 'power', { role: 'power' }),
      b('Temp +', 'amber', 'add', { role: 'temp_up' }),
      b('Temp −', 'blue', 'remove', { role: 'temp_down' }),
      b('Mode', 'slate', 'snow', { role: 'mode' }),
      b('Fan', 'slate', 'speedometer', { role: 'fan' }),
      b('Swing', 'slate', 'swap-vertical', { role: 'swing' }),
      b('Timer', 'slate', 'timer', { role: 'timer' }),
      b('Sleep', 'violet', 'moon', { role: 'sleep' }),
      b('Eco', 'mint', 'leaf', { role: 'eco' }),
    ],
  },
  {
    id: 'custom',
    title: 'Custom',
    description: 'Start from an empty grid: choose columns, then add buttons, headings and spacers with any size and shape.',
    category: 'Other',
    layout: 'custom',
    columns: 3,
    buttons: [],
  },
];

export function templateById(id: string): RemoteTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Effective column count for any layout. */
export function columnsFor(layout: RemoteLayout, columns?: number): number {
  switch (layout) {
    case 'grid2':
      return 2;
    case 'grid3':
      return 3;
    case 'list':
      return 1;
    case 'custom':
      return Math.min(5, Math.max(1, Math.round(columns ?? 3)));
    default:
      return 3;
  }
}

/**
 * Packs buttons into rows for a grid of `cols` columns, honoring spans
 * (clamped to the column count). Used by the custom-grid renderer.
 */
export function packRows<T extends { span?: number; kind?: ButtonKind }>(items: T[], cols: number): { item: T; span: number }[][] {
  const rows: { item: T; span: number }[][] = [];
  let row: { item: T; span: number }[] = [];
  let used = 0;
  for (const item of items) {
    const span = item.kind === 'label' ? cols : Math.min(cols, Math.max(1, Math.round(item.span ?? 1)));
    if (used + span > cols && row.length) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ item, span });
    used += span;
    if (used >= cols) {
      rows.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

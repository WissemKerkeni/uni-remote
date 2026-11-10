// Export / import of remote profiles as a versioned JSON document.
// Import is strict: unknown formats and signals that the firmware would
// refuse (non fixed-code, out of range) are rejected.
import { validateSignal } from '../domain/signal';
import {
  BUTTON_COLORS,
  BUTTON_ICONS,
  BUTTON_ROLES,
  BUTTON_SHAPES,
  MAX_COLUMNS,
  REMOTE_CATEGORIES,
  REMOTE_LAYOUTS,
  type Remote,
  type RemoteButton,
  type RfSignal,
  type SavedSignal,
} from '../domain/types';

export const PROFILE_FORMAT = 'uniremote.profiles';
export const PROFILE_VERSION = 1;

export interface ProfileFile {
  format: typeof PROFILE_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  remotes: Remote[];
  signals: SavedSignal[];
}

export function buildExport(remotes: Remote[], signals: SavedSignal[]): ProfileFile {
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'UniRemote 1.0.0',
    remotes,
    signals,
  };
}

export interface ImportResult {
  remotes: Remote[];
  signals: SavedSignal[];
  warnings: string[];
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');

function cleanSignal(raw: unknown): RfSignal | null {
  if (!isObj(raw)) return null;
  const s: RfSignal = {
    protocol: raw.protocol,
    bitLength: raw.bitLength,
    value: typeof raw.value === 'number' ? String(raw.value) : raw.value,
    pulseLength: raw.pulseLength ?? 0,
    repeat: raw.repeat ?? 10,
  };
  return validateSignal(s) === null ? s : null;
}

export function parseImport(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!isObj(doc) || doc.format !== PROFILE_FORMAT) throw new Error('Not a UniRemote profile file.');
  if (typeof doc.version !== 'number' || doc.version > PROFILE_VERSION)
    throw new Error(`Unsupported profile version ${String(doc.version)}. Update the app.`);

  const warnings: string[] = [];
  const now = Date.now();

  const remotes: Remote[] = (Array.isArray(doc.remotes) ? doc.remotes : []).filter(isObj).map((r: any, i: number) => {
    const buttons: RemoteButton[] = (Array.isArray(r.buttons) ? r.buttons : []).filter(isObj).map((b: any, j: number) => {
      const signal = b.signal === undefined ? undefined : cleanSignal(b.signal) ?? undefined;
      if (b.signal !== undefined && !signal) warnings.push(`"${str(r.name, 40)}" / "${str(b.label, 40)}": unsupported signal removed`);
      return {
        id: str(b.id, 64) || `b_imp_${i}_${j}`,
        label: str(b.label, 40) || 'Button',
        color: (BUTTON_COLORS as readonly string[]).includes(b.color) ? b.color : 'slate',
        icon: (BUTTON_ICONS as readonly string[]).includes(b.icon) ? b.icon : undefined,
        signal: b.kind === 'label' || b.kind === 'spacer' ? undefined : signal,
        kind: ['label', 'spacer'].includes(b.kind) ? b.kind : undefined,
        span: Number.isInteger(b.span) ? Math.min(MAX_COLUMNS, Math.max(1, b.span)) : undefined,
        shape: (BUTTON_SHAPES as readonly string[]).includes(b.shape) ? b.shape : undefined,
        role: (BUTTON_ROLES as readonly string[]).includes(b.role) ? b.role : undefined,
      };
    });
    return {
      id: str(r.id, 64) || `r_imp_${i}`,
      name: str(r.name, 60) || 'Imported remote',
      category: (REMOTE_CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'Other',
      layout: REMOTE_LAYOUTS.some((l) => l.id === r.layout) ? r.layout : 'grid2',
      columns: Number.isInteger(r.columns) ? Math.min(MAX_COLUMNS, Math.max(1, r.columns)) : undefined,
      buttons,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
      updatedAt: now,
    } satisfies Remote;
  });

  const signals: SavedSignal[] = [];
  for (const [i, x] of (Array.isArray(doc.signals) ? doc.signals : []).entries()) {
    if (!isObj(x)) continue;
    const signal = cleanSignal(x.signal);
    if (!signal) {
      warnings.push(`Signal "${str(x.name, 40)}": unsupported, skipped`);
      continue;
    }
    signals.push({ id: str(x.id, 64) || `s_imp_${i}`, name: str(x.name, 60) || 'Signal', signal, createdAt: typeof x.createdAt === 'number' ? x.createdAt : now });
  }

  return { remotes, signals, warnings };
}

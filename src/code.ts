// Figma main thread. Reads selection, snapshots both frames, resolves variable
// metadata (modes/values, with alias-chain support), and ships a Report to the UI.

import { compare } from './compare';
import type {
  Binding,
  CodeToUiMessage,
  FrameSnapshot,
  MatchedPair,
  ModeValue,
  NodeSnapshot,
  PropSnapshot,
  Report,
  ResolvedType,
  UiToCodeMessage,
  VarInfo,
  VarInfoCache,
} from './types';

figma.showUI(__html__, { width: 460, height: 640 });

// ----- Property catalogues (v0 scope per PLAN §4.2) -----

const SCALAR_NODE_PROPS = [
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'opacity',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
] as const;

const TEXT_SCALAR_PROPS = [
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'fontWeight',
] as const;

// ----- Helpers -----

function isContainer(n: SceneNode): n is SceneNode & ChildrenMixin {
  return 'children' in n;
}

function rgbaToHex(r: number, g: number, b: number, a?: number): string {
  const toByte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  const base = `#${toByte(r)}${toByte(g)}${toByte(b)}`;
  if (a !== undefined && a < 1) return base + toByte(a);
  return base;
}

function variableValueToString(value: VariableValue): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    if ('type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS') {
      return '(alias)';
    }
    if ('r' in value && 'g' in value && 'b' in value) {
      const c = value as RGBA;
      return rgbaToHex(c.r, c.g, c.b, 'a' in c ? c.a : undefined);
    }
  }
  return String(value);
}

// ----- Variable resolution with cache + alias chain cycle protection -----

interface CachedVar {
  variable: Variable;
  info: VarInfo;
}

const varCache: Map<string, CachedVar> = new Map();

async function resolveAliasValue(
  value: VariableValue,
  visited: Set<string>,
): Promise<VariableValue> {
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    (value as VariableAlias).type === 'VARIABLE_ALIAS'
  ) {
    const aliasId = (value as VariableAlias).id;
    if (visited.has(aliasId)) return '(cyclic alias)';
    visited.add(aliasId);
    const aliased = await figma.variables.getVariableByIdAsync(aliasId);
    if (!aliased) return '(missing alias)';
    const collection = await figma.variables.getVariableCollectionByIdAsync(
      aliased.variableCollectionId,
    );
    const modeId =
      collection?.defaultModeId ?? Object.keys(aliased.valuesByMode)[0];
    if (modeId === undefined) return '(no mode)';
    return resolveAliasValue(aliased.valuesByMode[modeId], visited);
  }
  return value;
}

async function getCachedVar(id: string): Promise<CachedVar | null> {
  const hit = varCache.get(id);
  if (hit) return hit;
  const v = await figma.variables.getVariableByIdAsync(id);
  if (!v) return null;
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    v.variableCollectionId,
  );
  const collectionName = collection?.name ?? '(unknown collection)';
  const modes: ModeValue[] = [];
  if (collection) {
    for (const mode of collection.modes) {
      const raw = v.valuesByMode[mode.modeId];
      if (raw === undefined) {
        modes.push({ modeName: mode.name, value: '(unset)' });
        continue;
      }
      const resolved = await resolveAliasValue(raw, new Set([id]));
      modes.push({
        modeName: mode.name,
        value: variableValueToString(resolved),
      });
    }
  }
  const cached: CachedVar = {
    variable: v,
    info: { variableName: v.name, collectionName, modes },
  };
  varCache.set(id, cached);
  return cached;
}

async function bindingFromAlias(alias: VariableAlias): Promise<Binding> {
  const cached = await getCachedVar(alias.id);
  if (!cached) {
    return {
      kind: 'variable',
      variableId: alias.id,
      variableName: '(missing)',
      resolvedType: 'STRING',
    };
  }
  return {
    kind: 'variable',
    variableId: alias.id,
    variableName: cached.info.variableName,
    resolvedType: cached.variable.resolvedType as ResolvedType,
  };
}

// ----- Path keys: stable layer identity for pairing -----

interface KeyedNode {
  node: SceneNode;
  key: string;
}

function flattenWithKeys(root: SceneNode): KeyedNode[] {
  const out: KeyedNode[] = [];
  const walk = (node: SceneNode, key: string) => {
    out.push({ node, key });
    if (!isContainer(node)) return;
    const total: Record<string, number> = {};
    for (const c of node.children) total[c.name] = (total[c.name] ?? 0) + 1;
    const seen: Record<string, number> = {};
    for (const c of node.children) {
      const t = total[c.name];
      let childKey: string;
      if (t > 1) {
        const idx = seen[c.name] ?? 0;
        seen[c.name] = idx + 1;
        childKey = `${key}/${c.name}[${idx}]`;
      } else {
        childKey = `${key}/${c.name}`;
      }
      walk(c, childKey);
    }
  };
  // Root pathKey is just its own name (frame-relative).
  walk(root, root.name);
  return out;
}

// ----- Per-node prop extraction -----

type AnyNode = SceneNode & {
  boundVariables?: Record<string, VariableAlias | VariableAlias[] | undefined>;
  [k: string]: unknown;
};

async function extractPaintProps(
  prefix: 'fills' | 'strokes',
  paints: readonly Paint[] | typeof figma.mixed,
): Promise<PropSnapshot[]> {
  if (paints === figma.mixed) {
    return [{ prop: prefix, binding: { kind: 'mixed' } }];
  }
  const out: PropSnapshot[] = [];
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (p.visible === false) continue;
    const propKey = `${prefix}[${i}].color`;
    if (p.type === 'SOLID') {
      const alias = p.boundVariables?.color;
      if (alias) {
        out.push({ prop: propKey, binding: await bindingFromAlias(alias) });
      } else {
        out.push({
          prop: propKey,
          binding: {
            kind: 'hardcoded',
            rawValue: rgbaToHex(p.color.r, p.color.g, p.color.b, p.opacity),
          },
        });
      }
    } else {
      // gradient/image/video — v0 detects only.
      out.push({
        prop: `${prefix}[${i}].${p.type.toLowerCase()}`,
        binding: { kind: 'hardcoded', rawValue: `(${p.type.toLowerCase()})` },
      });
    }
  }
  return out;
}

async function extractScalarProp(
  node: AnyNode,
  propName: string,
): Promise<PropSnapshot | null> {
  if (!(propName in node)) return null;
  const bv = node.boundVariables ?? {};
  const alias = bv[propName];
  if (alias && !Array.isArray(alias) && 'id' in alias) {
    return { prop: propName, binding: await bindingFromAlias(alias) };
  }
  const raw = node[propName];
  if (raw === undefined || raw === null) return null;
  if (raw === figma.mixed) {
    return { prop: propName, binding: { kind: 'mixed' } };
  }
  if (typeof raw === 'number') {
    return { prop: propName, binding: { kind: 'hardcoded', rawValue: String(raw) } };
  }
  if (typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    const r = raw as { value: number; unit?: string };
    return {
      prop: propName,
      binding: {
        kind: 'hardcoded',
        rawValue: `${r.value}${r.unit ? r.unit.toLowerCase() : ''}`,
      },
    };
  }
  return null;
}

// Resolve a paint-style id (node-level fill/stroke color style) to a binding.
const styleNameCache: Map<string, string> = new Map();
async function styleBinding(styleId: string): Promise<Binding> {
  let name = styleNameCache.get(styleId);
  if (name === undefined) {
    const style = await figma.getStyleByIdAsync(styleId);
    name = style ? style.name : '(missing style)';
    styleNameCache.set(styleId, name);
  }
  return { kind: 'style', styleId, styleName: name };
}

async function extractProps(node: SceneNode): Promise<PropSnapshot[]> {
  const props: PropSnapshot[] = [];
  const anyNode = node as AnyNode;

  // A node-level color style governs all of the node's fills/strokes, so prefer
  // it over per-paint extraction (otherwise the styled colors look hardcoded).
  if ('fills' in node) {
    const styleId = anyNode.fillStyleId;
    if (typeof styleId === 'string' && styleId !== '') {
      props.push({ prop: 'fillStyle', binding: await styleBinding(styleId) });
    } else {
      const fills = (node as GeometryMixin).fills;
      props.push(...(await extractPaintProps('fills', fills)));
    }
  }
  if ('strokes' in node) {
    const styleId = anyNode.strokeStyleId;
    if (typeof styleId === 'string' && styleId !== '') {
      props.push({ prop: 'strokeStyle', binding: await styleBinding(styleId) });
    } else {
      const strokes = (node as GeometryMixin).strokes;
      props.push(...(await extractPaintProps('strokes', strokes)));
    }
  }

  for (const propName of SCALAR_NODE_PROPS) {
    const snap = await extractScalarProp(anyNode, propName);
    if (snap) props.push(snap);
  }

  if (node.type === 'TEXT') {
    for (const propName of TEXT_SCALAR_PROPS) {
      const snap = await extractScalarProp(anyNode, propName);
      if (snap) props.push(snap);
    }
  }

  return props;
}

function nodeTop(node: SceneNode): number | null {
  const box = (node as SceneNode & { absoluteBoundingBox?: Rect | null })
    .absoluteBoundingBox;
  return box ? box.y : null;
}

async function snapshotFrame(root: SceneNode): Promise<FrameSnapshot> {
  const keyed = flattenWithKeys(root);
  const rootTop = nodeTop(root) ?? 0;
  const nodes: NodeSnapshot[] = [];
  for (const { node, key } of keyed) {
    const top = nodeTop(node);
    nodes.push({
      nodeId: node.id,
      pathKey: key,
      name: node.name,
      type: node.type,
      // Frame-relative top so both frames sort on the same origin.
      y: top === null ? 0 : top - rootTop,
      props: await extractProps(node),
    });
  }
  return { name: root.name, rootId: root.id, nodes };
}

// ----- Messaging -----

function post(msg: CodeToUiMessage) {
  figma.ui.postMessage(msg);
}

// Tell the UI which nodes are currently selected so it can highlight matching
// rows. Fires on every selection change, including programmatic ones.
function postSelection() {
  post({ type: 'selection', ids: figma.currentPage.selection.map((n) => n.id) });
}
figma.on('selectionchange', postSelection);

function varCacheToRecord(): VarInfoCache {
  const rec: VarInfoCache = {};
  for (const [id, cached] of varCache) rec[id] = cached.info;
  return rec;
}

// Export one thumbnail per grouped list item (the group-level layers) for the
// UI preview. Group nodes are resolved from finding.groupKey via matchedPairs,
// so only the layers the UI actually shows as group headers get exported.
// Resolve a frame's effective background color, honoring any variable bound to
// its fill for the frame's current mode (dark/light token). Returned as a hex
// string for the UI to paint behind that side's thumbnails. undefined if none.
async function resolveFrameBg(node: SceneNode): Promise<string | undefined> {
  if (!('fills' in node)) return undefined;
  const fills = (node as GeometryMixin).fills;
  if (fills === figma.mixed) return undefined;
  for (const p of fills) {
    if (p.visible === false) continue;
    if (p.type !== 'SOLID') continue;
    const solid = p as SolidPaint;
    const bound = solid.boundVariables && solid.boundVariables.color;
    if (bound) {
      const v = await figma.variables.getVariableByIdAsync(bound.id);
      if (v) {
        const resolved = v.resolveForConsumer(node).value;
        if (resolved && typeof resolved === 'object' && 'r' in resolved) {
          const c = resolved as RGBA;
          return rgbaToHex(c.r, c.g, c.b, 'a' in c ? c.a : undefined);
        }
      }
    }
    return rgbaToHex(solid.color.r, solid.color.g, solid.color.b, solid.opacity);
  }
  return undefined;
}

async function buildPreviews(report: Report): Promise<Record<string, string>> {
  const byPath: Record<string, MatchedPair> = {};
  for (const p of report.matchedPairs) byPath[p.pathKey] = p;

  const ids = new Set<string>();
  const seenGroups = new Set<string>();
  for (const f of report.findings) {
    // Group-header node (resolved via groupKey).
    if (f.groupKey && !seenGroups.has(f.groupKey)) {
      seenGroups.add(f.groupKey);
      const mp = byPath[f.groupKey];
      if (mp) {
        ids.add(mp.nodeIdA);
        ids.add(mp.nodeIdB);
      }
    }
    // Sub-layer nodes (each finding's own A/B layers).
    if (f.nodeIdA) ids.add(f.nodeIdA);
    if (f.nodeIdB) ids.add(f.nodeIdB);
  }
  const out: Record<string, string> = {};
  for (const id of ids) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || !('exportAsync' in node)) continue;
      const bytes = await (node as unknown as ExportMixin).exportAsync({
        format: 'PNG',
        constraint: { type: 'WIDTH', value: 240 },
      });
      out[id] = 'data:image/png;base64,' + figma.base64Encode(bytes);
    } catch (e) {
      // Some nodes (zero-area, unsupported types) can't be exported — skip.
    }
  }
  return out;
}

async function run() {
  const sel = figma.currentPage.selection;
  if (sel.length !== 2) {
    post({
      type: 'error',
      message: `프레임을 정확히 2개 선택하세요. (현재 ${sel.length}개 선택됨)`,
    });
    return;
  }
  const [a, b] = sel;
  try {
    const snapA = await snapshotFrame(a);
    const snapB = await snapshotFrame(b);
    const report = compare(snapA, snapB, varCacheToRecord());
    const previews = await buildPreviews(report);
    const bgA = await resolveFrameBg(a);
    const bgB = await resolveFrameBg(b);
    post({ type: 'report', report, previews, bgA, bgB });
    postSelection();
  } catch (e) {
    post({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

figma.ui.onmessage = async (msg: UiToCodeMessage) => {
  if (msg.type === 'run') {
    await run();
    return;
  }
  if (msg.type === 'select-node') {
    const node = await figma.getNodeByIdAsync(msg.nodeId);
    if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
      const scene = node as SceneNode;
      figma.currentPage.selection = [scene];
    }
    return;
  }
  if (msg.type === 'select-pair') {
    const ids = [msg.nodeIdA, msg.nodeIdB].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const scenes: SceneNode[] = [];
    for (const id of ids) {
      const node = await figma.getNodeByIdAsync(id);
      if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
        scenes.push(node as SceneNode);
      }
    }
    if (scenes.length > 0) {
      figma.currentPage.selection = scenes;
    }
    return;
  }
  if (msg.type === 'resize') {
    const w = Math.max(360, Math.round(msg.width));
    const h = Math.max(360, Math.round(msg.height));
    figma.ui.resize(w, h);
    return;
  }
  if (msg.type === 'rename') {
    const newName = msg.name.trim();
    const asScene = (n: BaseNode | null): SceneNode | null =>
      n && n.type !== 'PAGE' && n.type !== 'DOCUMENT' ? (n as SceneNode) : null;
    for (const pair of msg.pairs) {
      const a = asScene(
        pair.nodeIdA ? await figma.getNodeByIdAsync(pair.nodeIdA) : null,
      );
      const b = asScene(
        pair.nodeIdB ? await figma.getNodeByIdAsync(pair.nodeIdB) : null,
      );
      if (newName) {
        // Explicit name: unify both sides to it.
        if (a) a.name = newName;
        if (b) b.name = newName;
      } else if (a && b) {
        // No name given: match B to A's existing (layer-appropriate) name.
        b.name = a.name;
      }
    }
    // Renaming changes path keys, so re-snapshot to keep the report consistent.
    await run();
  }
};

run();

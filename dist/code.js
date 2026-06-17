"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // src/compare.ts
  function indexBy(items, key) {
    const map = /* @__PURE__ */ new Map();
    for (const item of items) map.set(key(item), item);
    return map;
  }
  function isToken(b) {
    return b.kind === "variable" || b.kind === "style";
  }
  function tokenId(b) {
    if (b.kind === "variable") return "var:" + b.variableId;
    if (b.kind === "style") return "style:" + b.styleId;
    return "";
  }
  function findingVerdict(a, b) {
    if (isToken(a) && isToken(b)) {
      return tokenId(a) === tokenId(b) ? "ok" : "diff-token";
    }
    if (a.kind === "hardcoded" && b.kind === "hardcoded") return "both-hardcoded";
    if (isToken(a) && b.kind === "hardcoded" || a.kind === "hardcoded" && isToken(b)) {
      return "one-hardcoded";
    }
    return "structure-prop";
  }
  function commonPrefixLen(paths) {
    if (paths.length === 0) return 0;
    let prefix = paths[0].split("/");
    for (let i = 1; i < paths.length; i++) {
      const segs = paths[i].split("/");
      let j = 0;
      while (j < prefix.length && j < segs.length && prefix[j] === segs[j]) j++;
      prefix = prefix.slice(0, j);
      if (prefix.length === 0) break;
    }
    return prefix.length;
  }
  function baseLenFor(findings) {
    if (findings.length === 0) return 0;
    const paths = findings.map((f) => f.pathKey);
    let baseLen = commonPrefixLen(paths);
    let maxLen = 0;
    for (const p of paths) maxLen = Math.max(maxLen, p.split("/").length);
    if (maxLen === baseLen) baseLen = Math.max(0, baseLen - 1);
    return baseLen;
  }
  function groupKeyForPath(pathKey, baseLen) {
    const segs = pathKey.split("/");
    return segs.length <= baseLen ? "" : segs.slice(0, baseLen + 1).join("/");
  }
  function assignGroupKeys(findings) {
    if (findings.length === 0) return;
    const baseLen = baseLenFor(findings);
    for (const f of findings) f.groupKey = groupKeyForPath(f.pathKey, baseLen);
  }
  function nameFallbackMatch(findings, matchedPairs, structureOnlyInA, structureOnlyInB, nodesA, nodesB, varCache) {
    const baseLen = baseLenFor(findings);
    const bucketKey = (n) => {
      const gk = groupKeyForPath(n.pathKey, baseLen);
      return gk ? gk + "\0" + n.name : null;
    };
    const bByKey = /* @__PURE__ */ new Map();
    for (const e of structureOnlyInB) {
      const nb = nodesB.get(e.pathKey);
      if (!nb) continue;
      const key = bucketKey(nb);
      if (!key) continue;
      const arr = bByKey.get(key);
      if (arr) arr.push(nb);
      else bByKey.set(key, [nb]);
    }
    const usedA = /* @__PURE__ */ new Set();
    const usedB = /* @__PURE__ */ new Set();
    for (const e of structureOnlyInA) {
      const na = nodesA.get(e.pathKey);
      if (!na) continue;
      const key = bucketKey(na);
      if (!key) continue;
      const bucket = bByKey.get(key);
      if (!bucket) continue;
      let nb;
      for (const cand of bucket) {
        if (!usedB.has(cand.nodeId)) {
          nb = cand;
          break;
        }
      }
      if (!nb) continue;
      usedA.add(na.nodeId);
      usedB.add(nb.nodeId);
      for (const f of compareNodes(na, nb, varCache)) {
        f.nameMatched = true;
        findings.push(f);
      }
      matchedPairs.push({
        pathKey: na.pathKey,
        nodeIdA: na.nodeId,
        nodeIdB: nb.nodeId,
        y: na.y
      });
    }
    return {
      remainingA: structureOnlyInA.filter((e) => {
        const na = nodesA.get(e.pathKey);
        return !na || !usedA.has(na.nodeId);
      }),
      remainingB: structureOnlyInB.filter((e) => {
        const nb = nodesB.get(e.pathKey);
        return !nb || !usedB.has(nb.nodeId);
      })
    };
  }
  function compareNodes(a, b, varCache) {
    var _a, _b, _c, _d;
    const propsA = indexBy(a.props, (p) => p.prop);
    const propsB = indexBy(b.props, (p) => p.prop);
    const propKeys = /* @__PURE__ */ new Set([...propsA.keys(), ...propsB.keys()]);
    const findings = [];
    for (const prop of propKeys) {
      const bindA = (_b = (_a = propsA.get(prop)) == null ? void 0 : _a.binding) != null ? _b : { kind: "absent" };
      const bindB = (_d = (_c = propsB.get(prop)) == null ? void 0 : _c.binding) != null ? _d : { kind: "absent" };
      if (bindA.kind === "absent" && bindB.kind === "absent") continue;
      const verdict = findingVerdict(bindA, bindB);
      const finding = {
        pathKey: a.pathKey,
        nodeIdA: a.nodeId,
        nodeIdB: b.nodeId,
        prop,
        verdict,
        a: bindA,
        b: bindB,
        y: a.y
      };
      if (verdict === "ok" && bindA.kind === "variable") {
        const v = varCache[bindA.variableId];
        if (v) finding.varInfo = v;
      } else if (verdict === "diff-token" && bindA.kind === "variable") {
        const v = varCache[bindA.variableId];
        if (v) finding.varInfo = v;
      }
      findings.push(finding);
    }
    return findings;
  }
  function collectHardcoded(snap) {
    const entries = [];
    for (const node of snap.nodes) {
      for (const prop of node.props) {
        if (prop.binding.kind === "hardcoded") {
          entries.push({
            pathKey: node.pathKey,
            nodeId: node.nodeId,
            prop: prop.prop,
            rawValue: prop.binding.rawValue,
            y: node.y
          });
        }
      }
    }
    return entries;
  }
  function compare(a, b, varCache = {}) {
    const nodesA = indexBy(a.nodes, (n) => n.pathKey);
    const nodesB = indexBy(b.nodes, (n) => n.pathKey);
    const keys = /* @__PURE__ */ new Set([...nodesA.keys(), ...nodesB.keys()]);
    const structureOnlyInA = [];
    const structureOnlyInB = [];
    const findings = [];
    const matchedPairs = [];
    for (const key of keys) {
      const na = nodesA.get(key);
      const nb = nodesB.get(key);
      if (na && !nb) {
        structureOnlyInA.push({ pathKey: key, nodeId: na.nodeId, y: na.y });
        continue;
      }
      if (nb && !na) {
        structureOnlyInB.push({ pathKey: key, nodeId: nb.nodeId, y: nb.y });
        continue;
      }
      if (na && nb) {
        matchedPairs.push({
          pathKey: key,
          nodeIdA: na.nodeId,
          nodeIdB: nb.nodeId,
          y: na.y
        });
        findings.push(...compareNodes(na, nb, varCache));
      }
    }
    const fallback = nameFallbackMatch(
      findings,
      matchedPairs,
      structureOnlyInA,
      structureOnlyInB,
      nodesA,
      nodesB,
      varCache
    );
    const remStructureA = fallback.remainingA;
    const remStructureB = fallback.remainingB;
    let ok = 0;
    let mismatch = 0;
    let warn = 0;
    for (const f of findings) {
      switch (f.verdict) {
        case "ok":
          ok++;
          break;
        case "diff-token":
        case "one-hardcoded":
        case "structure-prop":
          mismatch++;
          break;
        case "both-hardcoded":
          warn++;
          break;
      }
    }
    const byY = (x, z) => {
      var _a, _b;
      return ((_a = x.y) != null ? _a : 0) - ((_b = z.y) != null ? _b : 0) || (x.pathKey < z.pathKey ? -1 : x.pathKey > z.pathKey ? 1 : 0);
    };
    findings.sort(byY);
    assignGroupKeys(findings);
    matchedPairs.sort(byY);
    remStructureA.sort(byY);
    remStructureB.sort(byY);
    const hardcodedInA = collectHardcoded(a).sort(byY);
    const hardcodedInB = collectHardcoded(b).sort(byY);
    return {
      framesOk: true,
      frameAName: a.name,
      frameBName: b.name,
      structureOnlyInA: remStructureA,
      structureOnlyInB: remStructureB,
      findings,
      matchedPairs,
      hardcodedInA,
      hardcodedInB,
      summary: {
        ok,
        mismatch,
        warn,
        hardcoded: hardcodedInA.length + hardcodedInB.length,
        structureDiff: remStructureA.length + remStructureB.length
      }
    };
  }
  var init_compare = __esm({
    "src/compare.ts"() {
      "use strict";
    }
  });

  // src/code.ts
  var require_code = __commonJS({
    "src/code.ts"(exports) {
      init_compare();
      figma.showUI(__html__, { width: 460, height: 640 });
      var SCALAR_NODE_PROPS = [
        "cornerRadius",
        "topLeftRadius",
        "topRightRadius",
        "bottomLeftRadius",
        "bottomRightRadius",
        "opacity",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "itemSpacing"
      ];
      var TEXT_SCALAR_PROPS = [
        "fontSize",
        "lineHeight",
        "letterSpacing",
        "fontWeight"
      ];
      function isContainer(n) {
        return "children" in n;
      }
      function rgbaToHex(r, g, b, a) {
        const toByte = (n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0").toUpperCase();
        const base = `#${toByte(r)}${toByte(g)}${toByte(b)}`;
        if (a !== void 0 && a < 1) return base + toByte(a);
        return base;
      }
      function variableValueToString(value) {
        if (typeof value === "number") return String(value);
        if (typeof value === "string") return value;
        if (typeof value === "boolean") return String(value);
        if (value && typeof value === "object") {
          if ("type" in value && value.type === "VARIABLE_ALIAS") {
            return "(alias)";
          }
          if ("r" in value && "g" in value && "b" in value) {
            const c = value;
            return rgbaToHex(c.r, c.g, c.b, "a" in c ? c.a : void 0);
          }
        }
        return String(value);
      }
      var varCache = /* @__PURE__ */ new Map();
      function resolveAliasValue(value, visited) {
        return __async(this, null, function* () {
          var _a;
          if (value && typeof value === "object" && "type" in value && value.type === "VARIABLE_ALIAS") {
            const aliasId = value.id;
            if (visited.has(aliasId)) return "(cyclic alias)";
            visited.add(aliasId);
            const aliased = yield figma.variables.getVariableByIdAsync(aliasId);
            if (!aliased) return "(missing alias)";
            const collection = yield figma.variables.getVariableCollectionByIdAsync(
              aliased.variableCollectionId
            );
            const modeId = (_a = collection == null ? void 0 : collection.defaultModeId) != null ? _a : Object.keys(aliased.valuesByMode)[0];
            if (modeId === void 0) return "(no mode)";
            return resolveAliasValue(aliased.valuesByMode[modeId], visited);
          }
          return value;
        });
      }
      function getCachedVar(id) {
        return __async(this, null, function* () {
          var _a;
          const hit = varCache.get(id);
          if (hit) return hit;
          const v = yield figma.variables.getVariableByIdAsync(id);
          if (!v) return null;
          const collection = yield figma.variables.getVariableCollectionByIdAsync(
            v.variableCollectionId
          );
          const collectionName = (_a = collection == null ? void 0 : collection.name) != null ? _a : "(unknown collection)";
          const modes = [];
          if (collection) {
            for (const mode of collection.modes) {
              const raw = v.valuesByMode[mode.modeId];
              if (raw === void 0) {
                modes.push({ modeName: mode.name, value: "(unset)" });
                continue;
              }
              const resolved = yield resolveAliasValue(raw, /* @__PURE__ */ new Set([id]));
              modes.push({
                modeName: mode.name,
                value: variableValueToString(resolved)
              });
            }
          }
          const cached = {
            variable: v,
            info: { variableName: v.name, collectionName, modes }
          };
          varCache.set(id, cached);
          return cached;
        });
      }
      function bindingFromAlias(alias) {
        return __async(this, null, function* () {
          const cached = yield getCachedVar(alias.id);
          if (!cached) {
            return {
              kind: "variable",
              variableId: alias.id,
              variableName: "(missing)",
              resolvedType: "STRING"
            };
          }
          return {
            kind: "variable",
            variableId: alias.id,
            variableName: cached.info.variableName,
            resolvedType: cached.variable.resolvedType
          };
        });
      }
      function flattenWithKeys(root) {
        const out = [];
        const walk = (node, key) => {
          var _a, _b;
          out.push({ node, key });
          if (!isContainer(node)) return;
          const total = {};
          for (const c of node.children) total[c.name] = ((_a = total[c.name]) != null ? _a : 0) + 1;
          const seen = {};
          for (const c of node.children) {
            const t = total[c.name];
            let childKey;
            if (t > 1) {
              const idx = (_b = seen[c.name]) != null ? _b : 0;
              seen[c.name] = idx + 1;
              childKey = `${key}/${c.name}[${idx}]`;
            } else {
              childKey = `${key}/${c.name}`;
            }
            walk(c, childKey);
          }
        };
        walk(root, root.name);
        return out;
      }
      function extractPaintProps(prefix, paints) {
        return __async(this, null, function* () {
          var _a;
          if (paints === figma.mixed) {
            return [{ prop: prefix, binding: { kind: "mixed" } }];
          }
          const out = [];
          for (let i = 0; i < paints.length; i++) {
            const p = paints[i];
            if (p.visible === false) continue;
            const propKey = `${prefix}[${i}].color`;
            if (p.type === "SOLID") {
              const alias = (_a = p.boundVariables) == null ? void 0 : _a.color;
              if (alias) {
                out.push({ prop: propKey, binding: yield bindingFromAlias(alias) });
              } else {
                out.push({
                  prop: propKey,
                  binding: {
                    kind: "hardcoded",
                    rawValue: rgbaToHex(p.color.r, p.color.g, p.color.b, p.opacity)
                  }
                });
              }
            } else {
              out.push({
                prop: `${prefix}[${i}].${p.type.toLowerCase()}`,
                binding: { kind: "hardcoded", rawValue: `(${p.type.toLowerCase()})` }
              });
            }
          }
          return out;
        });
      }
      function extractScalarProp(node, propName) {
        return __async(this, null, function* () {
          var _a;
          if (!(propName in node)) return null;
          const bv = (_a = node.boundVariables) != null ? _a : {};
          const alias = bv[propName];
          if (alias && !Array.isArray(alias) && "id" in alias) {
            return { prop: propName, binding: yield bindingFromAlias(alias) };
          }
          const raw = node[propName];
          if (raw === void 0 || raw === null) return null;
          if (raw === figma.mixed) {
            return { prop: propName, binding: { kind: "mixed" } };
          }
          if (typeof raw === "number") {
            return { prop: propName, binding: { kind: "hardcoded", rawValue: String(raw) } };
          }
          if (typeof raw === "object" && "value" in raw) {
            const r = raw;
            return {
              prop: propName,
              binding: {
                kind: "hardcoded",
                rawValue: `${r.value}${r.unit ? r.unit.toLowerCase() : ""}`
              }
            };
          }
          return null;
        });
      }
      var styleNameCache = /* @__PURE__ */ new Map();
      function styleBinding(styleId) {
        return __async(this, null, function* () {
          let name = styleNameCache.get(styleId);
          if (name === void 0) {
            const style = yield figma.getStyleByIdAsync(styleId);
            name = style ? style.name : "(missing style)";
            styleNameCache.set(styleId, name);
          }
          return { kind: "style", styleId, styleName: name };
        });
      }
      function extractProps(node) {
        return __async(this, null, function* () {
          const props = [];
          const anyNode = node;
          if ("fills" in node) {
            const styleId = anyNode.fillStyleId;
            if (typeof styleId === "string" && styleId !== "") {
              props.push({ prop: "fillStyle", binding: yield styleBinding(styleId) });
            } else {
              const fills = node.fills;
              props.push(...yield extractPaintProps("fills", fills));
            }
          }
          if ("strokes" in node) {
            const styleId = anyNode.strokeStyleId;
            if (typeof styleId === "string" && styleId !== "") {
              props.push({ prop: "strokeStyle", binding: yield styleBinding(styleId) });
            } else {
              const strokes = node.strokes;
              props.push(...yield extractPaintProps("strokes", strokes));
            }
          }
          for (const propName of SCALAR_NODE_PROPS) {
            const snap = yield extractScalarProp(anyNode, propName);
            if (snap) props.push(snap);
          }
          if (node.type === "TEXT") {
            for (const propName of TEXT_SCALAR_PROPS) {
              const snap = yield extractScalarProp(anyNode, propName);
              if (snap) props.push(snap);
            }
          }
          return props;
        });
      }
      function nodeTop(node) {
        const box = node.absoluteBoundingBox;
        return box ? box.y : null;
      }
      function snapshotFrame(root) {
        return __async(this, null, function* () {
          var _a;
          const keyed = flattenWithKeys(root);
          const rootTop = (_a = nodeTop(root)) != null ? _a : 0;
          const nodes = [];
          for (const { node, key } of keyed) {
            const top = nodeTop(node);
            nodes.push({
              nodeId: node.id,
              pathKey: key,
              name: node.name,
              type: node.type,
              // Frame-relative top so both frames sort on the same origin.
              y: top === null ? 0 : top - rootTop,
              props: yield extractProps(node)
            });
          }
          return { name: root.name, rootId: root.id, nodes };
        });
      }
      function post(msg) {
        figma.ui.postMessage(msg);
      }
      function postSelection() {
        post({ type: "selection", ids: figma.currentPage.selection.map((n) => n.id) });
      }
      figma.on("selectionchange", postSelection);
      function varCacheToRecord() {
        const rec = {};
        for (const [id, cached] of varCache) rec[id] = cached.info;
        return rec;
      }
      function resolveFrameBg(node) {
        return __async(this, null, function* () {
          if (!("fills" in node)) return void 0;
          const fills = node.fills;
          if (fills === figma.mixed) return void 0;
          for (const p of fills) {
            if (p.visible === false) continue;
            if (p.type !== "SOLID") continue;
            const solid = p;
            const bound = solid.boundVariables && solid.boundVariables.color;
            if (bound) {
              const v = yield figma.variables.getVariableByIdAsync(bound.id);
              if (v) {
                const resolved = v.resolveForConsumer(node).value;
                if (resolved && typeof resolved === "object" && "r" in resolved) {
                  const c = resolved;
                  return rgbaToHex(c.r, c.g, c.b, "a" in c ? c.a : void 0);
                }
              }
            }
            return rgbaToHex(solid.color.r, solid.color.g, solid.color.b, solid.opacity);
          }
          return void 0;
        });
      }
      function buildPreviews(report) {
        return __async(this, null, function* () {
          const byPath = {};
          for (const p of report.matchedPairs) byPath[p.pathKey] = p;
          const ids = /* @__PURE__ */ new Set();
          const seenGroups = /* @__PURE__ */ new Set();
          for (const f of report.findings) {
            if (f.groupKey && !seenGroups.has(f.groupKey)) {
              seenGroups.add(f.groupKey);
              const mp = byPath[f.groupKey];
              if (mp) {
                ids.add(mp.nodeIdA);
                ids.add(mp.nodeIdB);
              }
            }
            if (f.nodeIdA) ids.add(f.nodeIdA);
            if (f.nodeIdB) ids.add(f.nodeIdB);
          }
          const out = {};
          for (const id of ids) {
            try {
              const node = yield figma.getNodeByIdAsync(id);
              if (!node || !("exportAsync" in node)) continue;
              const bytes = yield node.exportAsync({
                format: "PNG",
                constraint: { type: "WIDTH", value: 240 }
              });
              out[id] = "data:image/png;base64," + figma.base64Encode(bytes);
            } catch (e) {
            }
          }
          return out;
        });
      }
      function run() {
        return __async(this, null, function* () {
          const sel = figma.currentPage.selection;
          if (sel.length !== 2) {
            post({
              type: "error",
              message: `\uD504\uB808\uC784\uC744 \uC815\uD655\uD788 2\uAC1C \uC120\uD0DD\uD558\uC138\uC694. (\uD604\uC7AC ${sel.length}\uAC1C \uC120\uD0DD\uB428)`
            });
            return;
          }
          const [a, b] = sel;
          try {
            const snapA = yield snapshotFrame(a);
            const snapB = yield snapshotFrame(b);
            const report = compare(snapA, snapB, varCacheToRecord());
            const previews = yield buildPreviews(report);
            const bgA = yield resolveFrameBg(a);
            const bgB = yield resolveFrameBg(b);
            post({ type: "report", report, previews, bgA, bgB });
            postSelection();
          } catch (e) {
            post({
              type: "error",
              message: e instanceof Error ? e.message : String(e)
            });
          }
        });
      }
      figma.ui.onmessage = (msg) => __async(exports, null, function* () {
        if (msg.type === "run") {
          yield run();
          return;
        }
        if (msg.type === "select-node") {
          const node = yield figma.getNodeByIdAsync(msg.nodeId);
          if (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
            const scene = node;
            figma.currentPage.selection = [scene];
          }
          return;
        }
        if (msg.type === "select-pair") {
          const ids = [msg.nodeIdA, msg.nodeIdB].filter(
            (id) => typeof id === "string" && id.length > 0
          );
          const scenes = [];
          for (const id of ids) {
            const node = yield figma.getNodeByIdAsync(id);
            if (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
              scenes.push(node);
            }
          }
          if (scenes.length > 0) {
            figma.currentPage.selection = scenes;
          }
          return;
        }
        if (msg.type === "resize") {
          const w = Math.max(360, Math.round(msg.width));
          const h = Math.max(360, Math.round(msg.height));
          figma.ui.resize(w, h);
          return;
        }
        if (msg.type === "rename") {
          const newName = msg.name.trim();
          const asScene = (n) => n && n.type !== "PAGE" && n.type !== "DOCUMENT" ? n : null;
          for (const pair of msg.pairs) {
            const a = asScene(
              pair.nodeIdA ? yield figma.getNodeByIdAsync(pair.nodeIdA) : null
            );
            const b = asScene(
              pair.nodeIdB ? yield figma.getNodeByIdAsync(pair.nodeIdB) : null
            );
            if (newName) {
              if (a) a.name = newName;
              if (b) b.name = newName;
            } else if (a && b) {
              b.name = a.name;
            }
          }
          yield run();
        }
      });
      run();
    }
  });
  require_code();
})();

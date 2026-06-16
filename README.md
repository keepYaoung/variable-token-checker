# Variable Checker

> 🇰🇷 한국어 문서: [README.ko.md](README.ko.md)

A Figma plugin that compares two frames with the **same layout but different modes**
(e.g. Light / Dark). It checks whether matching layers bind the **same variable
tokens**, shows each mode's resolved value side-by-side, and flags **hardcoded
values** that should have been tokenized.

## Why

When you build a screen in Light mode and a Dark version next to it, both frames
should bind the same variable token on every layer — only the *mode value* of the
token differs. Drift is easy to introduce: someone hardcodes a color, swaps a token
for a similar-looking one, or adds a layer to one frame and forgets the other.
This plugin surfaces all three.

## What it checks

| A side | B side | Verdict |
|---|---|---|
| variable X | variable X | **OK** (mode values shown) |
| variable X | variable Y | **diff-token** |
| variable | hardcoded | **one-hardcoded** |
| hardcoded | variable | **one-hardcoded** |
| hardcoded | hardcoded | **both-hardcoded** (warn) |
| variable | absent / mixed | **structure-prop** |

Layer pairing uses **path keys**: the layer name chain from the root frame, with
same-name siblings disambiguated by `[0]`, `[1]`, … indexes.

## v0 scope

| Group | Properties |
|---|---|
| Color | `fills[i].color`, `strokes[i].color` (SOLID paints only; gradient / image flagged but not deep-compared) |
| Scalars | `cornerRadius` (+ all four corners), `opacity`, `paddingLeft/Right/Top/Bottom`, `itemSpacing` |
| Text | `fontSize`, `lineHeight`, `letterSpacing`, `fontWeight` |

## Install (development)

1. `npm install`
2. `npm run build` — produces `dist/code.js` and `dist/ui.html`.
3. In Figma desktop: **Plugins → Development → Import plugin from manifest…**
   and pick this folder's `manifest.json`.

`dist/` is committed, so step 1 and 2 are only needed if you change the source.

## Usage

1. Select **exactly two** frames that should share token bindings
   (e.g. a `Light` frame and a `Dark` frame).
2. Run **Plugins → Development → Variable Checker**.
3. Inspect the tabs:
   - **Mismatches** — every non-OK finding (diff-token, one-hardcoded,
     structure-prop, both-hardcoded).
   - **Structure** — layers present in only one frame.
   - **Hardcoded** — every non-tokenized value, per frame.
   - **OK** — matched bindings, each expandable into a Mode × Value table.
4. Click any item to jump to that layer in the canvas.
5. Change the selection and hit **Re-run**.

## Development

```bash
npm run watch       # esbuild watch (rebuild + copy ui.html)
npm run typecheck   # tsc --noEmit
npm test            # node --test against the pure compare() function
```

### Layout

```
variable-checker/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ build.mjs              # esbuild bundle + ui.html copy
├─ src/
│  ├─ code.ts             # Figma main thread (snapshot + variable resolution)
│  ├─ compare.ts          # pure comparison (Figma-API-free, unit-testable)
│  ├─ types.ts            # shared schema + ui<->code message types
│  └─ ui.html             # UI thread (report renderer)
├─ test/
│  └─ compare.test.mjs    # 8 cases over the verdict matrix
└─ dist/                  # build output (committed; referenced by manifest)
```

### Edit loop

Edit a file under `src/` → `npm run build` → re-run the plugin in Figma.
Run `npm run typecheck` after type changes, `npm test` after touching
`compare.ts`.

## Manifest notes

- `documentAccess: "dynamic-page"` — variable lookups therefore go through the
  **async** API (`getVariableByIdAsync`, `getVariableCollectionByIdAsync`).
- `networkAccess: { allowedDomains: ["none"] }` — no outbound traffic.

## Known limits (deferred past v0)

- Effects / gradient / image paints are *detected*, not deep-compared against
  tokens.
- Layer pairing is purely name + same-name index — renaming a layer in one frame
  shows up as a structure diff rather than a property diff.
- Style-based tokens (non-variable) are not compared.
- 3+ modes / cross-collection checks are out of scope.

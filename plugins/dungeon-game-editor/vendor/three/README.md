# vendor/three

Vendored subset of [three.js](https://github.com/mrdoob/three.js) for the dungeon-game-editor
"3Dモデルから生成" (enemy sprite model renderer) feature. Editor-side only — never referenced by
`dungeon-service.js`, `render-core.js`, or the SGDK C template.

## Files

| File | Origin | Modified? |
|---|---|---|
| `three.module.js` | `three@0.160.0` npm package, `build/three.module.js` | No — byte-verbatim |
| `GLTFLoader.js` | `three@0.160.0`, `examples/jsm/loaders/GLTFLoader.js` | Yes — import specifiers rewritten (see header comment in the file) |
| `BufferGeometryUtils.js` | `three@0.160.0`, `examples/jsm/utils/BufferGeometryUtils.js` | Yes — import specifier rewritten (see header comment in the file) |
| `LICENSE` | `three@0.160.0` package LICENSE (MIT) | No |

## Version

Pinned to **three@0.160.0** (r160). Obtained via `npm pack three@0.160.0` and extracted from the
resulting tarball (`package/build/three.module.js`, `package/examples/jsm/loaders/GLTFLoader.js`,
`package/examples/jsm/utils/BufferGeometryUtils.js`, `package/LICENSE`).

## Why the rewrite

`file://` page loads have no import map, so bare specifiers (`from 'three'`) cannot resolve.
Both `GLTFLoader.js` and `BufferGeometryUtils.js` had their `three` import rewritten to the
relative `./three.module.js` path; `GLTFLoader.js`'s `../utils/BufferGeometryUtils.js` import was
rewritten to `./BufferGeometryUtils.js` since both files now live flat in this directory.
`three.module.js` itself needed no changes (it has no external imports).

## Not vendored

DRACO / KTX2 / meshopt (Basis Universal) decoders are intentionally **not** vendored. Models that
declare `KHR_draco_mesh_compression`, `KHR_texture_basisu`, or `EXT_meshopt_compression` in
`extensionsRequired` are rejected before parsing by `enemy-model-render.js` with a
"非対応の圧縮形式" error, rather than silently failing or producing corrupt geometry.

## Updating the version

1. `npm pack three@<version>` in a scratch dir, extract the tarball.
2. Copy `build/three.module.js`, `examples/jsm/loaders/GLTFLoader.js`,
   `examples/jsm/utils/BufferGeometryUtils.js`, and `LICENSE` into this directory.
3. Re-apply the import-specifier rewrites described above (grep for `from 'three'` and
   `../utils/BufferGeometryUtils.js` in the two example files and fix them).
4. Update the version noted in this file and in the header comments of the two rewritten files.
5. `grep -n "from 'three'" plugins/dungeon-game-editor/vendor/three/*.js` must return nothing.
6. Re-run the manual E2E check in `docs/DUNGEON_MAINTENANCE.md` (enemy model generator section).

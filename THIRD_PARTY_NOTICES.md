# Third-Party Notices

The project code at the repository root is licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Files obtained from other
projects, packages, content providers, or hosted services remain subject to
their own license terms. The root license does not replace or modify those
terms.

## Repository dependency

| Component | Location or use | Upstream | License |
|---|---|---|---|
| hakoniwa-web3d-drone | `third_party/hakoniwa-web3d-drone/` | <https://github.com/hako-community/hakoniwa-web3d-drone> | The license in the checked-out revision's root `LICENSE`; its own `THIRD_PARTY_NOTICES.md` applies recursively |

Do not remove or replace license files contained below `third_party/` or its
nested `thirdparty/` directory.

## Browser runtime dependencies

These components are loaded from a CDN or through the repository dependency
above. They are not relicensed by this project.

| Component | Version used | Upstream | License |
|---|---:|---|---|
| Mapray JS | 0.9.6 | <https://github.com/sony/mapray-js> | Apache License 2.0 for the published 0.9.6 package |
| Mapray UI | 0.9.6 | <https://mapray.com/documents/mapray-js/getting-started/> | Terms and notices supplied with the Mapray UI distribution |
| Three.js | 0.160.0 (r160) | <https://github.com/mrdoob/three.js> | MIT License |
| Proj4js | 2.9.2 | <https://github.com/proj4js/proj4js> | MIT License |
| Leaflet | 1.9.4 | <https://github.com/Leaflet/Leaflet> | BSD 2-Clause License |
| Leaflet.RotatedMarker | 0.2.0 | <https://github.com/bbecquet/Leaflet.RotatedMarker> | MIT License |
| es-module-shims | 1.6.3 | <https://github.com/guybedford/es-module-shims> | MIT License |
| hakoniwa-pdu-javascript | Checked-out submodule revision | <https://github.com/hakoniwalab/hakoniwa-pdu-javascript> | MIT License |

When redistributing a vendored copy, preserve the corresponding upstream
license file. CDN-hosted packages are also governed by the terms of their CDN
and upstream distribution.

## Hosted maps, cloud services, and datasets

The following are data or services rather than code covered by the root
software license:

- **Mapray Cloud and Mapray-provided map data**: follow the
  [Mapray terms](https://mapray.com/terms/) and the
  [Mapray attribution guidance](https://mapray.com/documents/introduction/attribution/).
- **OpenStreetMap tiles and data**: copyright OpenStreetMap contributors;
  follow the [OpenStreetMap copyright and license page](https://www.openstreetmap.org/copyright)
  and the tile service usage policy.
- **PLATEAU 3D city model data**: follow the terms and attribution packaged
  with the dataset and the [PLATEAU website](https://www.mlit.go.jp/plateau/).

Dataset IDs, API keys, access tokens, and service access are not granted by
the repository license.

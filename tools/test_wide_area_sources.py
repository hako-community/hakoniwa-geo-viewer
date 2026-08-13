from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent


class WideAreaSourceContractTest(unittest.TestCase):
    def test_public_b3d_uses_only_required_second_meshes(self) -> None:
        mapray = json.loads((ROOT / "config/mapray.json").read_text(encoding="utf-8"))
        self.assertEqual("public-wide", mapray["buildingSourceMode"])
        self.assertEqual(
            [
                "https://opentiles.mapray.com/3dcity/533935/",
                "https://opentiles.mapray.com/3dcity/533945/",
            ],
            mapray["publicBuildingTilePrefixes"],
        )

    def test_source_catalog_preserves_local_assets_and_defers_conversion(self) -> None:
        catalog = json.loads(
            (
                WORKSPACE
                / "runtime/windows/scenarios/shibuya/wide-area-source-catalog.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(6, len(catalog["aoi"]["municipalities"]))
        self.assertEqual(
            "mapray-public-tokyo-b3d", catalog["decision"]["selected_candidate"]
        )
        self.assertIn("600m", catalog["decision"]["preserved_local_scope"])
        public = next(item for item in catalog["candidates"] if item["priority"] == 1)
        self.assertFalse(public["self_conversion_required"])
        self.assertEqual("ready", public["status"])
        self.assertEqual("pass", catalog["decision"]["acceptance_evidence"]["result"])
        self.assertGreaterEqual(
            catalog["decision"]["acceptance_evidence"]["page_fps_median"], 30
        )
        fallback = next(item for item in catalog["candidates"] if item["priority"] == 3)
        self.assertEqual(77, fallback["buffered_query_building_gml_files"])
        self.assertEqual(8, len(fallback["municipality_breakdown"]))

    def test_structured_attribution_is_rendered_as_html(self) -> None:
        source = (ROOT / "src/client/src/mapray_layer.js").read_text(encoding="utf-8")
        self.assertIn("anchor.textContent", source)
        self.assertIn("anchor.outerHTML", source)
        self.assertNotIn("addAttribution?.(attribution);", source)


if __name__ == "__main__":
    unittest.main()

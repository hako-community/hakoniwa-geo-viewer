from __future__ import annotations

import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseCContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.data = json.loads(
            (ROOT / "config/operations/shibuya-wide-area-5km.geojson")
            .read_text(encoding="utf-8")
        )
        self.features = self.data["features"]

    def features_of_type(self, feature_type: str) -> list[dict]:
        return [
            feature for feature in self.features
            if feature.get("properties", {}).get("type") == feature_type
        ]

    def test_wide_area_scenario_contents(self) -> None:
        self.assertGreaterEqual(len(self.features_of_type("planned_route")), 3)
        self.assertEqual(len(self.features_of_type("vertiport")), 2)
        self.assertEqual(len(self.features_of_type("incident_site")), 1)
        self.assertEqual(len(self.features_of_type("local_analysis_area")), 1)
        rules = {
            feature["properties"].get("rule")
            for feature in self.features_of_type("geofence")
        }
        self.assertEqual(rules, {"containment", "exclusion"})

    def test_operational_extent_is_approximately_5km(self) -> None:
        points: list[tuple[float, float]] = []

        def visit(value: object) -> None:
            if not isinstance(value, list):
                return
            if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
                points.append((float(value[0]), float(value[1])))
                return
            for item in value:
                visit(item)

        for feature in self.features:
            visit(feature.get("geometry", {}).get("coordinates"))
        west, east = min(p[0] for p in points), max(p[0] for p in points)
        south, north = min(p[1] for p in points), max(p[1] for p in points)
        center_lat = (south + north) / 2
        width_m = (east - west) * 111_320 * math.cos(math.radians(center_lat))
        height_m = (north - south) * 111_320
        self.assertGreaterEqual(width_m, 4_500)
        self.assertGreaterEqual(height_m, 4_500)
        self.assertLessEqual(max(width_m, height_m), 6_000)

    def test_ui_has_stage_c_controls_and_synthetic_label(self) -> None:
        html = (ROOT / "src/client/index.html").read_text(encoding="utf-8")
        ui = (ROOT / "src/client/src/ui.js").read_text(encoding="utf-8")
        runtime = (ROOT / "src/client/src/scenario_runtime.mjs").read_text(encoding="utf-8")
        for control in ("focus-wide-area-btn", "focus-incident-btn", "focus-local-area-btn"):
            self.assertIn(control, html)
        self.assertIn("createWideAreaScenario", ui)
        self.assertIn("synthetic_scenario", ui)
        self.assertIn("SYNTHETIC FLEET", runtime)


if __name__ == "__main__":
    unittest.main()

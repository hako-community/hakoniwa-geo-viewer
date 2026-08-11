from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseR5ContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_operations_geojson_structure(self) -> None:
        geojson = json.loads(self.read("config/operations/shibuya-patrol.geojson"))
        self.assertEqual("FeatureCollection", geojson.get("type"))
        features = geojson.get("features", [])
        self.assertGreaterEqual(len(features), 2)
        types = [f["properties"].get("type") for f in features]
        self.assertIn("planned_route", types)
        self.assertIn("geofence", types)

    def test_flight_rules_module(self) -> None:
        rules = self.read("src/client/src/flight_rules.mjs")
        self.assertIn("export function evaluateFlightRules", rules)
        self.assertIn("export function isPointIn2DPolygon", rules)
        self.assertIn("GEOFENCE_BREACH", rules)
        self.assertIn("ROUTE_DEVIATION", rules)

    def test_operations_layer_model(self) -> None:
        model = self.read("src/client/src/operations_layer.mjs")
        self.assertIn("class OperationsLayerModel", model)
        this_prune = "cutoffTime"
        self.assertIn(this_prune, model)
        self.assertIn("appendTrajectoryPoint", model)

    def test_mapray_layer_operations_integration(self) -> None:
        layer = self.read("src/client/src/mapray_layer.js")
        self.assertIn("OperationsLayerModel", layer)
        self.assertIn("loadOperationsData", layer)
        this_traj = "_updateTrajectoryEntity"
        self.assertIn(this_traj, layer)

    def test_ui_flight_rules_integration(self) -> None:
        ui = self.read("src/client/src/ui.js")
        self.assertIn("evaluateFlightRules", ui)
        self.assertIn("shibuya-patrol.geojson", ui)


if __name__ == "__main__":
    unittest.main()

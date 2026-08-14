from __future__ import annotations

import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_json(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


class TokyoTowerScenarioContractTest(unittest.TestCase):
    def test_scenario_declares_ready_wide_and_planned_local_coverage(self) -> None:
        scenario = load_json("config/scenarios/tokyo-tower.json")
        self.assertEqual("tokyo-tower", scenario["id"])
        self.assertEqual(5000, scenario["coverage"]["wideArea"]["widthM"])
        self.assertEqual("ready", scenario["coverage"]["wideArea"]["dataStatus"])
        self.assertEqual(600, scenario["coverage"]["localDetail"]["widthM"])
        self.assertEqual("planned", scenario["coverage"]["localDetail"]["dataStatus"])
        self.assertNotIn("runtimeManifest", scenario["paths"])
        self.assertNotIn("terrainGrid", scenario["paths"])

    def test_mapray_uses_four_public_second_meshes(self) -> None:
        mapray = load_json("config/mapray-tokyo-tower.json")
        self.assertEqual("public-wide", mapray["buildingSourceMode"])
        self.assertEqual(
            [
                "https://opentiles.mapray.com/3dcity/533935/",
                "https://opentiles.mapray.com/3dcity/533936/",
                "https://opentiles.mapray.com/3dcity/533945/",
                "https://opentiles.mapray.com/3dcity/533946/",
            ],
            mapray["publicBuildingTilePrefixes"],
        )

    def test_three_scene_uses_current_public_plateau_endpoints(self) -> None:
        scene = load_json("config/web3d-scene-tokyo-tower.json")
        self.assertEqual("wide", scene["initialEnvironmentScope"])
        self.assertEqual(1, len(scene["environments"]))
        wide = scene["environments"][0]
        self.assertEqual("plateau-3dtiles", wide["type"])
        self.assertEqual(5000, wide["clipSizeM"])
        self.assertEqual(6, len(wide["sources"]))
        self.assertTrue(all("bldg-lod1-latest" in item["url"] for item in wide["sources"]))
        self.assertTrue(all("-texture-latest" not in item["url"] for item in wide["sources"]))

        fixture = load_json("config/web3d-scene-tokyo-tower-r7-fleet-fixture.json")
        self.assertEqual(30, len(fixture["drones"]))
        self.assertEqual("Drone-A", fixture["drones"][0]["name"])
        self.assertEqual("Drone-AD", fixture["drones"][-1]["name"])
        self.assertEqual(
            wide["sources"],
            fixture["environments"][0]["sources"],
        )

    def test_operations_layer_is_five_kilometres_square(self) -> None:
        operations = load_json("config/operations/tokyo-tower-wide-area-5km.geojson")
        features = operations["features"]
        by_type: dict[str, list[dict]] = {}
        for feature in features:
            by_type.setdefault(feature["properties"]["type"], []).append(feature)
        self.assertEqual(3, len(by_type["planned_route"]))
        self.assertEqual(1, len(by_type["local_analysis_area"]))
        self.assertEqual(1, len(by_type["incident_site"]))
        self.assertEqual(1, len(by_type["landmark"]))

        boundary = next(
            feature for feature in by_type["geofence"]
            if feature["properties"].get("rule") == "containment"
        )["geometry"]["coordinates"][0]
        west, south = boundary[0][:2]
        east, north = boundary[2][:2]
        center_lat = (south + north) / 2
        height_m = (north - south) * 111_320
        width_m = (east - west) * 111_320 * math.cos(math.radians(center_lat))
        self.assertAlmostEqual(5000, width_m, delta=15)
        self.assertAlmostEqual(5000, height_m, delta=15)


if __name__ == "__main__":
    unittest.main()

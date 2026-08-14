from __future__ import annotations

import json
import math
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def load_json(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


class TokyoTowerScenarioContractTest(unittest.TestCase):
    def test_scenario_declares_ready_wide_and_local_coverage(self) -> None:
        scenario = load_json("config/scenarios/tokyo-tower.json")
        self.assertEqual("tokyo-tower", scenario["id"])
        self.assertEqual(5000, scenario["coverage"]["wideArea"]["widthM"])
        self.assertEqual("ready", scenario["coverage"]["wideArea"]["dataStatus"])
        self.assertEqual(600, scenario["coverage"]["localDetail"]["widthM"])
        self.assertEqual("ready", scenario["coverage"]["localDetail"]["dataStatus"])
        self.assertEqual("../../runtime-assets/tokyo-tower/manifest.json", scenario["paths"]["runtimeManifest"])
        self.assertEqual("../../runtime-assets/tokyo-tower/terrain-grid.json", scenario["paths"]["terrainGrid"])

    def test_local_assets_share_the_coordinate_contract_and_tower_proxy(self) -> None:
        manifest = load_json("runtime-assets/tokyo-tower/manifest.json")
        self.assertEqual("tokyo-tower", manifest["scenarioId"])
        contract = manifest["coordinateContract"]
        self.assertEqual("mujoco_x_north_y_minus_east_z_up", contract["frame"])
        self.assertEqual(257, contract["rows"])
        self.assertEqual(257, contract["columns"])
        self.assertAlmostEqual(4.9, contract["zBaselineM"])

        lod1 = load_json("runtime-assets/tokyo-tower/buildings-lod1.json")
        tower = next(
            item for item in lod1["polygons"]
            if item["id"] == "bldg_7aff4a51-be8b-405b-abe4-ac489697cbc8"
        )
        self.assertEqual("measuredHeight", tower["height_source"])
        self.assertAlmostEqual(332.1, tower["measured_height_m"])
        self.assertAlmostEqual(350.5, tower["zmax"])

        scene = load_json("config/web3d-scene-tokyo-tower.json")
        vertical = scene["environments"][0]["verticalReference"]
        source = load_json("runtime-assets/tokyo-tower/source-manifest.json")
        self.assertEqual(2025, source["source"]["year"])
        self.assertEqual("5.0", source["source"]["specification"])
        self.assertEqual("53393599", source["source"]["files"][0]["mesh"])
        self.assertAlmostEqual(
            source["verticalReference"]["geoidHeightM"],
            vertical["geoidHeightM"],
        )
        self.assertAlmostEqual(
            vertical["zBaselineM"] + vertical["geoidHeightM"],
            vertical["localOriginEllipsoidalHeightM"],
        )

        xml = ET.parse(ROOT / "runtime-assets/tokyo-tower/buildings.xml").getroot()
        tower_geom = next(
            geom for geom in xml.findall(".//geom")
            if "7aff4a51-be8b-405b-abe4-ac489697cbc8" in (geom.get("name") or "")
        )
        center_z = float(tower_geom.get("pos").split()[2])
        half_height = float(tower_geom.get("size").split()[2])
        self.assertAlmostEqual(
            tower["zmax"] - contract["zBaselineM"],
            center_z + half_height,
            places=5,
        )

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
        self.assertEqual(4, len(scene["environments"]))
        wide = scene["environments"][0]
        self.assertEqual("plateau-3dtiles", wide["type"])
        self.assertEqual(5000, wide["clipSizeM"])
        self.assertEqual(6, len(wide["sources"]))
        self.assertTrue(all("bldg-lod1-latest" in item["url"] for item in wide["sources"]))
        self.assertTrue(all("-texture-latest" not in item["url"] for item in wide["sources"]))
        self.assertAlmostEqual(36.5945, wide["verticalReference"]["geoidHeightM"])
        self.assertAlmostEqual(4.9, wide["verticalReference"]["zBaselineM"])
        self.assertEqual(
            ["tokyo-tower-terrain", "tokyo-tower-plateau-lod1", "tokyo-tower-collision-buildings"],
            [item["name"] for item in scene["environments"][1:]],
        )

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
        local_area = by_type["local_analysis_area"][0]["properties"]
        self.assertEqual("ready", local_area["dataStatus"])
        self.assertNotIn("planned", local_area["name"].lower())
        self.assertNotIn("pending", local_area["detailCoverage"].lower())
        self.assertNotIn("pending", operations["properties"]["detailCoverage"].lower())

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

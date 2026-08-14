from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseEPresentationContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_r7_scene_uses_lod1_and_all_fleet_models(self) -> None:
        scene = json.loads(self.read("config/web3d-scene-r7-fleet-fixture.json"))
        lod1 = next(item for item in scene["environments"] if item["type"] == "lod1-city")
        collision = next(item for item in scene["environments"] if item.get("kind") == "mjcf")
        self.assertEqual(["physics", "visual"], lod1["modes"])
        self.assertEqual("../runtime-assets/shibuya/buildings-lod1.json", lod1["lod1Path"])
        self.assertEqual(15.07, lod1["zBaselineM"])
        self.assertFalse(collision["enabled"])
        self.assertEqual("fixed", scene["main_camera"]["initialMode"])
        self.assertIn("targetPositionRos", scene["main_camera"])
        names = {item["name"] for item in scene["drones"]}
        self.assertEqual(30, len(names))
        self.assertTrue({"Drone-E", "Drone-Q", "Drone-AD"}.issubset(names))
        self.assertEqual("origin-01", scene["defaultDroneProfile"])
        self.assertEqual("origin_01", scene["droneProfiles"]["origin-01"]["droneType"])

    def test_origin_01_assets_and_operational_visibility_contract(self) -> None:
        model_root = ROOT / "third_party/hakoniwa-web3d-drone"
        origin_type = json.loads(
            (model_root / "config/drone_types-origin-01.json").read_text(encoding="utf-8")
        )["origin_01"]
        self.assertEqual(0.6, origin_type["model"]["scale"])
        self.assertEqual(120, origin_type["wideVisualScale"])
        self.assertEqual(12, origin_type["localVisualScale"])
        self.assertIn("Dynamics", origin_type["model"]["hiddenNodes"])
        self.assertEqual(4, len(origin_type["rotors"]))
        self.assertEqual(1, len(origin_type["cameras"]))
        self.assertIn("window", origin_type["cameras"][0])
        for relative in (
            "assets/models/origin-01.glb",
            "assets/models/propeller_origin_01.glb",
            "assets/models/origin-01-LICENSE.txt",
            "src/drone_operational_visualization.js",
        ):
            self.assertTrue((model_root / relative).is_file(), relative)

        drone = (model_root / "src/drone.js").read_text(encoding="utf-8")
        app = (model_root / "src/app.js").read_text(encoding="utf-8")
        viewer = (model_root / "src/public/drone_viewer.js").read_text(encoding="utf-8")
        ui = self.read("src/client/src/ui.js")
        self.assertIn("setOperationalScope", drone)
        self.assertIn("configuredScale", drone)
        self.assertIn("visualRoot?.scale.setScalar", drone)
        self.assertIn("setOperationalSelectedDroneId", app)
        self.assertIn("const activeDrone = selectedDrone", app)
        self.assertIn("setSelectedDroneId", viewer)
        self.assertIn("viewer?.setSelectedDroneId", ui)
        self.assertIn("&& threeEnvironmentScope === 'local'", ui)
        self.assertIn("pageParams.get('autoCameraTour') === '1'", ui)
        self.assertIn("select: autoCameraTour", ui)
        self.assertNotIn("setEnvironmentScope(\"local\", { applyCamera: false })", app)

    def test_wide_area_route_speed_is_demo_readable(self) -> None:
        operations = json.loads(self.read("config/operations/shibuya-wide-area-5km.geojson"))
        routes = [
            feature for feature in operations["features"]
            if feature["properties"].get("type") == "planned_route"
        ]
        self.assertEqual(3, len(routes))
        self.assertTrue(all(route["properties"]["targetSpeedMps"] == 12.0 for route in routes))
        self.assertEqual([780, 800, 1100], [route["properties"]["cycleSeconds"] for route in routes])

    def test_deployed_lod1_asset_and_runtime_manifest(self) -> None:
        city = json.loads(self.read("runtime-assets/shibuya/buildings-lod1.json"))
        manifest = json.loads(self.read("runtime-assets/shibuya/manifest.json"))
        self.assertEqual("1.0", city["version"])
        self.assertEqual(801, len(city["polygons"]))
        self.assertIn("buildings-lod1.json", {item["path"] for item in manifest["files"]})

    def test_ui_explains_local_detail_coverage(self) -> None:
        html = self.read("src/client/index.html")
        ui = self.read("src/client/src/ui.js")
        self.assertIn('id="three-local-status"', html)
        self.assertIn('id="three-drone-legend"', html)
        self.assertIn("LOCAL 600m / PLATEAU LOD1", html)
        self.assertIn("LOD1_CITY_ENVIRONMENT_VERSION", ui)
        self.assertIn("insideLocalDetail", ui)
        self.assertIn("OUTSIDE LOCAL DETAIL", ui)
        self.assertIn("scenarioRuntime.isLive && pageParams.get('autoConnect') === '1'", ui)
        self.assertNotIn("enableAttachedCameras: false", ui)
        self.assertIn("pageParams.get('demoFlight') === '1'", ui)
        self.assertIn("pageParams.get('localPresentation') === '1'", ui)
        self.assertIn("presentation-start", ui)

    def test_threejs_wide_area_streaming_preserves_local_assets(self) -> None:
        scene = json.loads(self.read("config/web3d-scene-r7-fleet-fixture.json"))
        wide = next(item for item in scene["environments"] if item["type"] == "plateau-3dtiles")
        local = next(item for item in scene["environments"] if item["type"] == "lod1-city")
        collision = next(item for item in scene["environments"] if item.get("kind") == "mjcf")
        self.assertEqual("wide", scene["initialEnvironmentScope"])
        self.assertEqual(["wide"], wide["scopes"])
        self.assertEqual(5000, wide["ground"]["sizeM"])
        self.assertEqual(6, len(wide["sources"]))
        self.assertTrue(all("bldg-lod1-latest" in item["url"] for item in wide["sources"]))
        self.assertTrue(all("-texture-latest" not in item["url"] for item in wide["sources"]))
        self.assertEqual(["local"], local["scopes"])
        self.assertEqual(["local"], collision["scopes"])
        self.assertEqual("../runtime-assets/shibuya/buildings.xml", collision["model"])


if __name__ == "__main__":
    unittest.main()

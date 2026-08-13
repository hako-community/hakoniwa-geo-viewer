from __future__ import annotations

import json
import struct
import unittest
from pathlib import Path

from scenario_contract import validate_runtime_assets

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
WEB3D_ROOT = WORKSPACE / "hakoniwa-web3d-drone"


class PhaseR2ContractTest(unittest.TestCase):
    def test_shibuya_scene_uses_terrain_without_base_floor(self) -> None:
        scene = json.loads(
            (ROOT / "config/web3d-scene-shibuya.json").read_text(encoding="utf-8")
        )
        self.assertGreaterEqual(len(scene["environments"]), 1)
        terrain = next(
            item
            for item in scene["environments"]
            if item.get("name") == "shibuya-terrain"
        )
        self.assertEqual("terrain-grid", terrain["type"])
        self.assertEqual(
            "../runtime-assets/shibuya/terrain-grid.json",
            terrain["terrainGridPath"],
        )
        self.assertNotIn("base-floor.glb", json.dumps(scene))

    def test_wide_scene_uses_absolute_height_dem_without_flat_ground(self) -> None:
        scene = json.loads(
            (ROOT / "config/web3d-scene-shibuya.json").read_text(encoding="utf-8")
        )
        streamed_city = next(
            item
            for item in scene["environments"]
            if item.get("name") == "shibuya-wide-5km-plateau-lod1"
        )
        terrain = next(
            item
            for item in scene["environments"]
            if item.get("name") == "shibuya-wide-5km-dem"
        )
        self.assertFalse(streamed_city["ground"]["enabled"])
        self.assertEqual(["wide"], terrain["scopes"])
        self.assertEqual(
            "../runtime-assets/shibuya/terrain-grid-wide-5km.json",
            terrain["terrainGridPath"],
        )
        self.assertAlmostEqual(0.0, terrain["pos"][2], places=9)
        self.assertAlmostEqual(51.8482, streamed_city["origin"]["heightM"], places=4)
        self.assertAlmostEqual(0.5, streamed_city["verticalOffsetM"], places=9)
        self.assertAlmostEqual(
            36.7782,
            streamed_city["verticalReference"]["geoidHeightM"],
            places=4,
        )
        self.assertAlmostEqual(
            streamed_city["origin"]["heightM"],
            streamed_city["verticalReference"]["zBaselineM"]
            + streamed_city["verticalReference"]["geoidHeightM"],
            places=4,
        )
        self.assertEqual(88, scene["environmentScopes"]["wide"]["camera"]["maxPolarAngleDeg"])
        self.assertFalse(scene["environmentScopes"]["wide"]["camera"]["enablePan"])

        grid = json.loads(
            (ROOT / "runtime-assets/shibuya/terrain-grid-wide-5km.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual((513, 513), (grid["rows"], grid["columns"]))
        self.assertEqual((-2500.0, 2500.0), (grid["xMinM"], grid["xMaxM"]))
        self.assertEqual((-2500.0, 2500.0), (grid["yMinM"], grid["yMaxM"]))
        self.assertAlmostEqual(15.07, grid["zBaselineM"], places=9)
        absolute_heights = [value + grid["zBaselineM"] for value in grid["modelHeightsM"]]
        self.assertGreaterEqual(min(absolute_heights), 0.5)
        self.assertLessEqual(max(absolute_heights), 43.5)

    def test_actual_grid_produces_expected_geometry_size_and_frame(self) -> None:
        grid = json.loads(
            (ROOT / "runtime-assets/shibuya/terrain-grid.json").read_text(
                encoding="utf-8"
            )
        )
        rows = grid["rows"]
        columns = grid["columns"]
        self.assertEqual(66049, rows * columns)
        self.assertEqual(131072, (rows - 1) * (columns - 1) * 2)
        self.assertGreater(rows * columns, 65535)
        first = [-grid["yMinM"], grid["modelHeightsM"][0], -grid["xMinM"]]
        last = [-grid["yMaxM"], grid["modelHeightsM"][-1], -grid["xMaxM"]]
        self.assertEqual([300.0, grid["modelHeightsM"][0], 300.0], first)
        self.assertEqual([-300.0, grid["modelHeightsM"][-1], -300.0], last)
        float32_heights = [
            struct.unpack("<f", struct.pack("<f", float(value)))[0]
            for value in grid["modelHeightsM"]
        ]
        self.assertLessEqual(
            max(
                abs(float32 - float(source))
                for float32, source in zip(float32_heights, grid["modelHeightsM"])
            ),
            0.0001,
            "Float32 BufferGeometry Y must preserve modelHeightsM within 0.1 mm",
        )
        x_step = (grid["xMaxM"] - grid["xMinM"]) / (columns - 1)
        y_step = (grid["yMaxM"] - grid["yMinM"]) / (rows - 1)
        p00 = first
        p10 = [p00[0], grid["modelHeightsM"][1], p00[2] - x_step]
        p01 = [
            p00[0] - y_step,
            grid["modelHeightsM"][columns],
            p00[2],
        ]
        edge_a = [p10[index] - p00[index] for index in range(3)]
        edge_b = [p01[index] - p00[index] for index in range(3)]
        normal_y = edge_a[2] * edge_b[0] - edge_a[0] * edge_b[2]
        self.assertGreater(normal_y, 0, "terrain triangle winding must face +Y")

    def test_threejs_height_contract_matches_mujoco_samples(self) -> None:
        result = validate_runtime_assets()
        self.assertEqual(9, len(result["samples"]))
        center = next(
            sample
            for sample in result["samples"]
            if sample["xM"] == 0.0 and sample["yM"] == 0.0
        )
        self.assertLessEqual(
            abs(center["mujocoModelHeightM"] - center["threeModelHeightM"]),
            0.001,
        )
        for sample in result["samples"]:
            self.assertLessEqual(
                abs(
                    sample["mujocoModelHeightM"]
                    - sample["threeModelHeightM"]
                ),
                0.001,
            )
            self.assertAlmostEqual(
                sample["maprayAbsoluteHeightM"],
                sample["threeModelHeightM"] + sample["zBaselineM"],
                places=9,
            )

    def test_canonical_web3d_implements_terrain_environment(self) -> None:
        geometry = (WEB3D_ROOT / "src/terrain_grid_geometry.mjs").read_text(
            encoding="utf-8"
        )
        environment = (WEB3D_ROOT / "src/terrain_environment.js").read_text(
            encoding="utf-8"
        )
        viewer = (WEB3D_ROOT / "src/public/drone_viewer.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("new Uint32Array", geometry)
        self.assertIn("[-rosY, modelZ, -rosX]", geometry)
        self.assertIn("usesZBaselineInGeometry: false", geometry)
        self.assertIn("THREE.BufferGeometry", environment)
        self.assertIn("TERRAIN_GRID_ENVIRONMENT_VERSION", viewer)
        app = (WEB3D_ROOT / "src/app.js").read_text(encoding="utf-8")
        self.assertIn("for (let i = 0; i < drones.length; i++)", app)
        self.assertIn("drones[i].update(dt, keyState)", app)

    def test_geo_ui_has_compatibility_gate_and_diagnostics(self) -> None:
        html = (ROOT / "src/client/index.html").read_text(encoding="utf-8")
        ui = (ROOT / "src/client/src/ui.js").read_text(encoding="utf-8")
        self.assertIn('id="environment-status"', html)
        self.assertIn("terrainGridEnvironmentVersion >= 1", ui)
        self.assertIn("sceneConfigUrl", ui)
        self.assertIn("getEnvironmentDiagnostics", ui)
        self.assertIn("base-floorへフォールバック", ui)


if __name__ == "__main__":
    unittest.main()

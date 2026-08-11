from __future__ import annotations

import unittest
from pathlib import Path

from scenario_contract import ROOT, load_json, sha256, validate_runtime_assets


class PhaseR1ContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runtime = validate_runtime_assets()

    def test_old_thirdparty_directory_is_absent(self) -> None:
        self.assertFalse((ROOT / "thirdparty").exists())

    def test_viewer_scenario_resolves_only_inside_viewer_root(self) -> None:
        viewer_config_path = ROOT / "config/viewer-config-shibuya.json"
        viewer_config = load_json(viewer_config_path)
        scenario_path = (viewer_config_path.parent / viewer_config["scenarioConfigPath"]).resolve()
        self.assertTrue(scenario_path.is_relative_to(ROOT))
        scenario = load_json(scenario_path)
        self.assertEqual("shibuya", scenario["id"])
        for name, relative in scenario["paths"].items():
            with self.subTest(path=name):
                target = (scenario_path.parent / relative).resolve()
                self.assertTrue(target.is_relative_to(ROOT))
                self.assertTrue(target.is_file(), target)

    def test_manifest_hashes_match_deployed_and_source_files(self) -> None:
        manifest = self.runtime["manifest"]
        for item in manifest["files"]:
            with self.subTest(path=item["path"]):
                deployed = ROOT / "runtime-assets/shibuya" / item["path"]
                source = ROOT.parent / item["sourceRelativePath"]
                self.assertEqual(item["sha256"], sha256(deployed))
                self.assertTrue(source.is_file(), source)
                self.assertEqual(item["sha256"], sha256(source))

    def test_terrain_grid_and_vertical_baseline_contract(self) -> None:
        grid = self.runtime["grid"]
        origin = load_json(ROOT / "config/geo-origin.json")
        mapray = load_json(ROOT / "config/mapray.json")
        self.assertEqual(257, grid["rows"])
        self.assertEqual(257, grid["columns"])
        self.assertEqual(257 * 257, len(grid["modelHeightsM"]))
        self.assertAlmostEqual(grid["zBaselineM"], origin["z_offset"], places=9)
        self.assertEqual(
            "/runtime-assets/shibuya/terrain-grid.json",
            mapray["terrainGridUrl"],
        )
        self.assertEqual(
            "modelHeightsM + zBaselineM",
            self.runtime["manifest"]["coordinateContract"]["maprayAbsoluteHeight"],
        )

    def test_nine_point_mujoco_three_mapray_alignment(self) -> None:
        samples = self.runtime["samples"]
        self.assertEqual(9, len(samples))
        for sample in samples:
            with self.subTest(x=sample["xM"], y=sample["yM"]):
                self.assertAlmostEqual(
                    sample["mujocoModelHeightM"],
                    sample["threeModelHeightM"],
                    delta=0.001,
                )
                self.assertAlmostEqual(
                    sample["maprayAbsoluteHeightM"],
                    sample["threeModelHeightM"] + sample["zBaselineM"],
                    places=9,
                )

    def test_browser_loader_enforces_scenario_contract(self) -> None:
        source = (ROOT / "src/client/src/scenario_config.mjs").read_text(
            encoding="utf-8"
        )
        for marker in (
            "resolveSameOriginUrl",
            "validateRuntimeAssetManifest",
            "modelHeightsM + zBaselineM",
            "runtime asset coordinate frame mismatch",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main()

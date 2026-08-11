from __future__ import annotations

import json
import math
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB3D_ROOT = ROOT.parent / "hakoniwa-web3d-drone"


class PhaseR3ContractTest(unittest.TestCase):
    def test_shibuya_scene_selects_physics_buildings_by_default(self) -> None:
        scene = json.loads(
            (ROOT / "config/web3d-scene-shibuya.json").read_text(encoding="utf-8")
        )
        self.assertEqual("physics", scene["environmentMode"])
        mjcf = next(item for item in scene["environments"] if item.get("kind") == "mjcf")
        self.assertEqual("../runtime-assets/shibuya/buildings.xml", mjcf["model"])
        self.assertEqual(["physics"], mjcf["modes"])
        self.assertEqual("collision-debug", mjcf["material"]["mode"])
        self.assertLess(mjcf["material"]["opacity"], 1.0)
        visual = next(
            item
            for item in scene["environments"]
            if item["name"] == "shibuya-plateau-visual"
        )
        self.assertTrue(visual["optional"])
        self.assertEqual(["visual"], visual["modes"])

    def test_deployed_mjcf_contains_4266_collision_boxes(self) -> None:
        root = ET.parse(ROOT / "runtime-assets/shibuya/buildings.xml").getroot()
        geoms = [
            geom
            for geom in root.iter("geom")
            if (geom.get("name") or "").startswith("geom_bldg_")
        ]
        self.assertEqual(4266, len(geoms))
        self.assertTrue(all(geom.get("type") == "box" for geom in geoms))

    def test_known_w5_wall_collision_is_adjacent_to_a_rendered_box(self) -> None:
        point = (-17.7434, 11.3669, 17.6732)
        root = ET.parse(ROOT / "runtime-assets/shibuya/buildings.xml").getroot()
        nearest_outside = math.inf
        nearest_name = None
        for geom in root.iter("geom"):
            name = geom.get("name") or ""
            if not name.startswith("geom_bldg_"):
                continue
            pos = [float(value) for value in geom.get("pos", "").split()]
            half = [float(value) for value in geom.get("size", "").split()]
            yaw_deg = float(geom.get("euler", "0 0 0").split()[2])
            yaw = math.radians(yaw_deg)
            dx = point[0] - pos[0]
            dy = point[1] - pos[1]
            local_x = math.cos(yaw) * dx + math.sin(yaw) * dy
            local_y = -math.sin(yaw) * dx + math.cos(yaw) * dy
            outside = max(
                abs(local_x) - half[0],
                abs(local_y) - half[1],
                abs(point[2] - pos[2]) - half[2],
            )
            if outside < nearest_outside:
                nearest_outside = outside
                nearest_name = name
        self.assertEqual(
            "geom_bldg_09f2bea7-e77e-466d-aade-a152bb749c87_edge2",
            nearest_name,
        )
        self.assertLessEqual(nearest_outside, 0.25)

    def test_building_terrain_alignment_meets_r3_tolerance(self) -> None:
        manifest = json.loads(
            (ROOT / "runtime-assets/shibuya/terrain-source-manifest.json").read_text(
                encoding="utf-8"
            )
        )
        comparison = manifest["building_terrain_comparison"]
        self.assertEqual(801, comparison["matched_building_count"])
        self.assertLess(comparison["absolute_rms_m"], 1.0)
        self.assertGreater(comparison["within_2m_ratio"], 0.97)

    def test_canonical_renderer_uses_shared_frame_and_instancing(self) -> None:
        geometry = (WEB3D_ROOT / "src/mjcf_building_geometry.mjs").read_text(
            encoding="utf-8"
        )
        renderer = (WEB3D_ROOT / "src/mjcf_building.js").read_text(encoding="utf-8")
        self.assertIn("position: [-y, z, -x]", geometry)
        self.assertIn("new THREE.InstancedMesh", renderer)
        self.assertIn('renderStrategy: "instanced-mesh"', renderer)

    def test_ui_exposes_environment_and_drone_model_selection(self) -> None:
        html = (ROOT / "src/client/index.html").read_text(encoding="utf-8")
        ui = (ROOT / "src/client/src/ui.js").read_text(encoding="utf-8")
        self.assertIn('id="drone-profile-select"', html)
        self.assertIn('id="environment-mode-select"', html)
        self.assertIn("viewer.listDroneProfiles", ui)
        self.assertIn("MJCF_BUILDING_GEOMETRY_VERSION", ui)
        self.assertIn("droneProfileId:", ui)
        self.assertIn("environmentMode:", ui)


if __name__ == "__main__":
    unittest.main()

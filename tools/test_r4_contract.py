from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB3D_ROOT = ROOT.parent / "hakoniwa-web3d-drone"


class PhaseR4ContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_single_flight_state_store_drives_all_views(self) -> None:
        ui = self.read("src/client/src/ui.js")
        store = self.read("src/client/src/flight_state_store.mjs")
        self.assertIn("class FlightStateStore", store)
        self.assertIn("flightStateStore.subscribe", ui)
        self.assertIn("source: 'panel'", ui)
        self.assertIn("source: 'leaflet'", ui)
        self.assertIn("source: 'mapray'", ui)
        self.assertIn("viewer?.focusDroneById", ui)
        self.assertIn("maprayLayer?.setSelectedDroneId", ui)
        self.assertIn("__hakoniwaR4Diagnostics", ui)
        self.assertNotIn("currentDroneId", ui)

    def test_mapray_entities_are_pickable_and_camera_is_not_vertical(self) -> None:
        layer = self.read("src/client/src/mapray_layer.js")
        config = json.loads(self.read("config/mapray.json"))
        self.assertIn("this.viewer.pick(point)", layer)
        self.assertIn("setPickable(true)", layer)
        self.assertIn("createNonDegenerateCameraPose", layer)
        self.assertIn("setCameraPosition(cameraPosition)", layer)
        self.assertIn("setLookAtPosition(lookAtPosition, 0)", layer)
        self.assertIn("focusIncident", layer)
        self.assertGreaterEqual(config["camera"]["horizontalDistanceM"], 120)
        self.assertGreaterEqual(config["camera"]["minimumHorizontalDistanceM"], 10)

    def test_four_layouts_and_splitter_resize_contract(self) -> None:
        html = self.read("src/client/index.html")
        ui = self.read("src/client/src/ui.js")
        layouts = self.read("src/client/src/layout_modes.mjs")
        for mode in ("operations", "inspection", "incident", "offline"):
            self.assertIn(f'value="{mode}"', html)
            self.assertIn(f"{mode}:", layouts)
        self.assertIn("computeDraggedLayout", ui)
        self.assertIn("map.invalidateSize", ui)
        self.assertIn("viewer?.resize", ui)
        self.assertIn("maprayLayer?.resize", ui)
        self.assertIn("pointerdown", ui)
        self.assertIn("ensureGeoContext", ui)
        self.assertIn("void ensureGeoContext().catch", ui)

    def test_three_drone_manual_selection_fixture_is_available(self) -> None:
        scene = json.loads(self.read("config/web3d-scene-r4-selection-fixture.json"))
        self.assertEqual(["Drone-A", "Drone-B", "Drone-C"], [
            drone["name"] for drone in scene["drones"]
        ])
        self.assertIn("r4Fixture", self.read("src/client/src/ui.js"))
        self.assertIn("R4 fixture（通信なし", self.read("src/client/src/ui.js"))

    def test_incident_selection_updates_both_cameras_and_details(self) -> None:
        html = self.read("src/client/index.html")
        ui = self.read("src/client/src/ui.js")
        self.assertIn('id="collision-detail"', html)
        self.assertIn("selectIncident", ui)
        self.assertIn("maprayLayer?.focusIncident", ui)
        self.assertIn("viewer?.focusDroneById?.(event.droneId)", ui)
        self.assertIn("applyLayoutMode('incident')", ui)

    def test_canonical_viewer_exposes_selection_and_resize_diagnostics(self) -> None:
        viewer = (WEB3D_ROOT / "src/public/drone_viewer.js").read_text(
            encoding="utf-8"
        )
        app = (WEB3D_ROOT / "src/app.js").read_text(encoding="utf-8")
        self.assertIn("SELECTION_SYNC_API_VERSION", viewer)
        self.assertIn("getFocusedDroneId()", viewer)
        self.assertIn("resize()", viewer)
        self.assertIn("export function resizeViewer()", app)
        self.assertIn("cameraAspect", app)


if __name__ == "__main__":
    unittest.main()

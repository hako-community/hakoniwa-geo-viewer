from __future__ import annotations

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class GeoViewerContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_submodule_contract(self) -> None:
        gitmodules = self.read(".gitmodules")
        self.assertIn("third_party/hakoniwa-web3d-drone", gitmodules)
        self.assertIn("hako-community/hakoniwa-web3d-drone.git", gitmodules)
        self.assertTrue(
            (ROOT / "third_party/hakoniwa-web3d-drone/tools/hako.py").is_file()
        )

    def test_html_composes_map_and_threejs_regions(self) -> None:
        html = self.read("src/client/index.html")
        self.assertIn('id="map"', html)
        self.assertIn('id="three-root"', html)
        self.assertIn("new URL('./src/ui.js'", html)
        self.assertIn("await import(uiModuleUrl.href)", html)
        self.assertIn("phase-e-20260813-14", html)
        self.assertIn('"3d-tiles-renderer"', html)
        self.assertIn('"3d-tiles-renderer/gltf-cesium-rtc"', html)
        self.assertIn('id="benchmark-start-btn"', html)
        self.assertIn('id="benchmark-download-btn"', html)
        self.assertIn("Hakoniwa Geo + Web3D Drone Viewer", html)

    def test_ui_uses_public_threejs_viewer_api(self) -> None:
        ui = self.read("src/client/src/ui.js")
        self.assertIn(
            'DEFAULT_THREEJS_ROOT = "/third_party/hakoniwa-web3d-drone"', ui
        )
        self.assertIn('DEFAULT_VIEWER_CONFIG_NAME = "viewer-config-legacy.json"', ui)
        self.assertIn("/src/public/drone_viewer.js", ui)
        self.assertIn("createDroneViewer", ui)
        self.assertIn("viewer.connectPdu", ui)
        self.assertIn("collision_events.mjs?v=w6-20260808-9", ui)
        self.assertIn("loadViewerScenarioConfig", ui)
        self.assertIn("/config/viewer-config-shibuya.json", ui)
        self.assertIn("TERRAIN_GRID_ENVIRONMENT_VERSION", ui)
        self.assertIn("getEnvironmentDiagnostics", ui)
        self.assertIn("PLATEAU_3DTILES_ENVIRONMENT_VERSION", ui)
        self.assertIn("setEnvironmentScope", ui)

    def test_wide_dem_and_stream_diagnostics_are_packaged(self) -> None:
        self.assertTrue(
            (ROOT / "runtime-assets/shibuya/terrain-grid-wide-5km.json").is_file()
        )
        scene = self.read("config/web3d-scene-shibuya.json")
        streamed_city = self.read(
            "third_party/hakoniwa-web3d-drone/src/plateau_3dtiles_environment.js"
        )
        self.assertIn("shibuya-wide-5km-dem", scene)
        self.assertIn("terrain-grid-wide-5km.json", scene)
        self.assertIn("sourceStats", streamed_city)
        self.assertIn("rendererSources", streamed_city)

    def test_coordinate_conversion_contract_is_explicit(self) -> None:
        frame = self.read("src/client/src/frame.js")
        self.assertIn('defs["EPSG:6677"]', frame)
        self.assertIn("function rosToEnuFrame", frame)
        self.assertIn("return [-y_ros, x_ros, z_ros]", frame)
        self.assertIn("function ENUToLatLon", frame)

    def test_mapray_096_building_dataset_contract(self) -> None:
        html = self.read("src/client/index.html")
        layer = self.read("src/client/src/mapray_layer.js")
        config = self.read("config/mapray.json")
        ui = self.read("src/client/src/ui.js")
        self.assertIn("mapray-js/v0.9.6/mapray.min.js", html)
        self.assertIn('id="mapray-container"', html)
        self.assertIn("StandardB3dProvider", layer)
        self.assertIn("PinEntity", layer)
        self.assertIn("PathEntity", layer)
        self.assertIn('"6329541064654848"', config)
        self.assertIn('"4785831235551232"', config)
        self.assertIn('"5126075927494656"', config)
        self.assertIn("buildingDatasetIds", layer)
        self.assertIn("publicBuildingTilePrefixes", layer)
        self.assertIn("buildingSourceMode", layer)
        self.assertIn("this.buildingScenes", layer)
        self.assertIn("/b3ddatasets/v2/", layer)
        self.assertIn("new StandardB3dProvider(dataset.url, '.bin'", layer)
        self.assertIn("b3dCollection.createScene(provider)", layer)
        self.assertNotIn("new window.mapray.B3DCollection", layer)
        self.assertNotIn("window.mapray.B3DProvider ||", layer)
        self.assertIn("consumeMaprayApiKey", ui)
        self.assertIn("history.replaceState", ui)
        self.assertNotIn("YOUR_MAPRAY_API_KEY", config)

    def test_collision_event_contract(self) -> None:
        html = self.read("src/client/index.html")
        ui = self.read("src/client/src/ui.js")
        tracker = self.read("src/client/src/collision_events.mjs")
        bridge = self.read("../scripts/windows/pdu_web_bridge.py")
        self.assertIn('id="collision-panel"', html)
        self.assertIn("CollisionEventTracker", ui)
        self.assertIn("maprayLayer?.addCollision", ui)
        self.assertIn("classifyCollisionSurface", tracker)
        self.assertIn('2: ("impulse_collision", 216)', bridge)
        self.assertIn('18: ("status", 64)', bridge)
        self.assertIn("clients: dict[object, asyncio.Lock]", bridge)
        self.assertNotIn("single client bridge", bridge)
        self.assertNotIn("closing extra WebSocket client", bridge)

    def test_w6_dem_uses_the_mujoco_vertical_baseline(self) -> None:
        layer = self.read("src/client/src/mapray_layer.js")
        config = self.read("config/mapray.json")
        origin = self.read("config/geo-origin.json")
        ui = self.read("src/client/src/ui.js")
        self.assertIn("createDemFallbackProvider", layer)
        self.assertIn("new CloudDemProvider(apiKey)", layer)
        self.assertNotIn("new CloudDemProvider({ token: apiKey })", layer)
        self.assertIn("initOptions.dem_provider = demProvider", layer)
        self.assertIn("getMaprayLoadMode", ui)
        self.assertIn("/__runtime/mapray-config", ui)
        self.assertIn('"demDatasetId": "5129466653179904"', config)
        self.assertIn('"z_offset": 15.07', origin)
        self.assertIn("terrainGridUrl", config)
        self.assertTrue((ROOT / "src/client/src/terrain_height.mjs").is_file())

    def test_mapray_096_camera_contract_uses_geo_point_data(self) -> None:
        layer = self.read("src/client/src/mapray_layer.js")
        config = self.read("config/mapray.json")
        self.assertIn('"sdkVersion": "0.9.6"', config)
        self.assertIn("this.viewer.setCameraPosition(cameraPosition)", layer)
        self.assertIn("this.viewer.setLookAtPosition(lookAtPosition, 0)", layer)
        self.assertIn("horizontalDistanceM / 111_320", layer)
        self.assertIn(
            "mapray_layer.js?v=phase-e-20260813-14",
            self.read("src/client/src/ui.js"),
        )
        self.assertNotIn(
            "this.viewer.setCameraPosition(safeLat, safeLon", layer
        )

    def test_r7_demo_trajectory_updates_are_memory_bounded(self) -> None:
        layer = self.read("src/client/src/mapray_layer.js")
        ui = self.read("src/client/src/ui.js")
        self.assertIn("trajectorySampleIntervalMs", layer)
        self.assertIn("maxTrajectoryPoints", layer)
        self.assertIn("trajectoryLastSampleTimes", layer)
        self.assertIn("this.droneEntries.get(strId) || entity", layer)
        self.assertIn("TRAIL_SAMPLE_INTERVAL_MS = 500", ui)
        self.assertIn("TRAIL_MAX_POINTS = 120", ui)
        self.assertIn(".slice(-TRAIL_MAX_POINTS)", ui)

    def test_readme_describes_current_component_boundary(self) -> None:
        readme = self.read("README.md")
        self.assertNotIn("hakoniwa-webserver", readme)
        self.assertIn("python tools/hako.py doctor", readme)
        self.assertIn("hakoniwa-pdu-bridge-core", readme)
        self.assertIn("hakoniwa-web3d-drone", readme)
        self.assertIn("drone-single-mujoco-threejs-gamepad", readme)
        self.assertIn("13113_shibuya-ku_pref_2023_citygml_2_op.glb", readme)
        self.assertIn("標準起動には不要", readme)

    def test_optional_plateau_asset_is_not_required_by_doctor(self) -> None:
        hako = self.read("tools/hako.py")
        required_section = hako.split("REQUIRED_FILES =", 1)[1].split(
            "def _display", 1
        )[0]
        self.assertNotIn("SHIBUYA_GLB", required_section)
        self.assertIn("optional PLATEAU Shibuya GLB", hako)


if __name__ == "__main__":
    unittest.main()

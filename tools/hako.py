#!/usr/bin/env python3
"""Component-owned operational entry point for hakoniwa-geo-viewer."""

from __future__ import annotations

import argparse
import functools
import http.server
import mimetypes
import pathlib
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request

from scenario_contract import ScenarioContractError, validate_runtime_assets

ROOT = pathlib.Path(__file__).resolve().parents[1]
THREEJS_ROOT = ROOT / "third_party" / "hakoniwa-web3d-drone"
SHIBUYA_GLB = ROOT / "assets" / "models" / "13113_shibuya-ku_pref_2023_citygml_2_op.glb"

REQUIRED_FILES = (
    ROOT / "README.md",
    ROOT / ".gitmodules",
    ROOT / "src" / "client" / "index.html",
    ROOT / "src" / "client" / "src" / "ui.js",
    ROOT / "src" / "client" / "src" / "frame.js",
    ROOT / "src" / "client" / "src" / "mapray_layer.js",
    ROOT / "src" / "client" / "src" / "terrain_height.mjs",
    ROOT / "src" / "client" / "src" / "flight_state_store.mjs",
    ROOT / "src" / "client" / "src" / "layout_modes.mjs",
    ROOT / "src" / "client" / "src" / "location_selector.mjs",
    ROOT / "src" / "client" / "src" / "operations_layer.mjs",
    ROOT / "src" / "client" / "src" / "performance_monitor.mjs",
    ROOT / "src" / "client" / "src" / "scenario_runtime.mjs",
    ROOT / "src" / "client" / "src" / "wide_area_scenario.mjs",
    ROOT / "config" / "geo-origin.json",
    ROOT / "config" / "geo-origin-tokyo-tower.json",
    ROOT / "config" / "mapray.json",
    ROOT / "config" / "mapray-tokyo-tower.json",
    ROOT / "config" / "viewer-config-shibuya.json",
    ROOT / "config" / "viewer-config-tokyo-tower.json",
    ROOT / "config" / "scenarios" / "shibuya.json",
    ROOT / "config" / "scenarios" / "tokyo-tower.json",
    ROOT / "config" / "operations" / "shibuya-wide-area-5km.geojson",
    ROOT / "config" / "operations" / "tokyo-tower-wide-area-5km.geojson",
    ROOT / "config" / "web3d-scene-shibuya.json",
    ROOT / "config" / "web3d-scene-tokyo-tower.json",
    ROOT / "config" / "web3d-scene-tokyo-tower-r7-fleet-fixture.json",
    ROOT / "config" / "web3d-scene-shibuya-terrain-only.json",
    ROOT / "config" / "web3d-scene-r4-selection-fixture.json",
    ROOT / "runtime-assets" / "shibuya" / "manifest.json",
    ROOT / "runtime-assets" / "shibuya" / "terrain-grid.json",
    ROOT / "runtime-assets" / "shibuya" / "terrain-grid-wide-5km.json",
    ROOT / "runtime-assets" / "shibuya" / "buildings.xml",
    ROOT / "runtime-assets" / "shibuya" / "buildings-lod1.json",
    ROOT / "images" / "drone.svg",
    THREEJS_ROOT / "tools" / "hako.py",
    THREEJS_ROOT / "src" / "public" / "drone_viewer.js",
    THREEJS_ROOT / "src" / "drone_operational_visualization.js",
    THREEJS_ROOT / "config" / "viewer-config-legacy.json",
    THREEJS_ROOT / "config" / "drone_types-origin-01.json",
    THREEJS_ROOT / "assets" / "models" / "origin-01.glb",
    THREEJS_ROOT / "assets" / "models" / "propeller_origin_01.glb",
    THREEJS_ROOT / "assets" / "models" / "origin-01-LICENSE.txt",
)


def _display(path: pathlib.Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _run_threejs(command: str) -> int:
    entry = THREEJS_ROOT / "tools" / "hako.py"
    if not entry.is_file():
        print(
            "ERROR: Three.js submodule is not initialized. "
            "Run: git submodule update --init --recursive",
            file=sys.stderr,
        )
        return 1
    completed = subprocess.run(
        [sys.executable, str(entry), command],
        cwd=THREEJS_ROOT,
        check=False,
    )
    return completed.returncode


def doctor() -> int:
    errors: list[str] = []

    if sys.version_info < (3, 9):
        errors.append(
            f"Python 3.9 or newer is required; found {sys.version.split()[0]}"
        )

    for path in REQUIRED_FILES:
        if not path.is_file():
            errors.append(f"missing required file: {_display(path)}")

    gitmodules = ROOT / ".gitmodules"
    if gitmodules.is_file():
        text = gitmodules.read_text(encoding="utf-8")
        expected = "third_party/hakoniwa-web3d-drone"
        if expected not in text:
            errors.append(f".gitmodules does not declare {expected}")

    if errors:
        for message in errors:
            print(f"ERROR: {message}", file=sys.stderr)
        print(
            "Remediation: git submodule update --init --recursive",
            file=sys.stderr,
        )
        return 1

    try:
        runtime_contract = validate_runtime_assets()
    except (OSError, ValueError, ScenarioContractError) as exc:
        print(f"ERROR: R1 scenario contract failed: {exc}", file=sys.stderr)
        print(
            "Remediation: run ..\\scripts\\windows\\deploy_viewer_assets.ps1",
            file=sys.stderr,
        )
        return 1

    nested = _run_threejs("doctor")
    if nested != 0:
        print("ERROR: embedded Three.js viewer doctor failed", file=sys.stderr)
        return nested

    print(f"OK: Python {sys.version.split()[0]}")
    print("OK: geo-viewer static integration files are present")
    print(
        "OK: R1 runtime asset hashes and "
        f"{len(runtime_contract['samples'])}-point height contract passed"
    )
    print("OK: embedded hakoniwa-web3d-drone is operational")
    if SHIBUYA_GLB.is_file():
        print(f"INFO: optional PLATEAU asset found: {_display(SHIBUYA_GLB)}")
    else:
        print(
            "INFO: optional PLATEAU Shibuya GLB is not installed; "
            "the base viewer remains usable"
        )
    return 0


def test() -> int:
    own_tests = subprocess.run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tools",
            "-p",
            "test_*.py",
        ],
        cwd=ROOT,
        check=False,
    )
    if own_tests.returncode != 0:
        return own_tests.returncode

    node = shutil.which("node")
    if node:
        for script in (
            "test_collision_events.mjs",
            "test_flight_state_store.mjs",
            "test_location_selector.mjs",
            "test_operations_layer.mjs",
            "test_operations_evaluation.mjs",
            "test_performance_monitor.mjs",
            "test_scenario_runtime.mjs",
            "test_wide_area_scenario.mjs",
        ):
            logic_tests = subprocess.run(
                [node, str(ROOT / "tools" / script)],
                cwd=ROOT,
                check=False,
            )
            if logic_tests.returncode != 0:
                return logic_tests.returncode
    else:
        print("NOTE: Node.js not found; collision logic test was skipped")

    nested = _run_threejs("test")
    if nested != 0:
        print("ERROR: embedded Three.js viewer tests failed", file=sys.stderr)
        return nested

    print("OK: geo-viewer and embedded Three.js contracts passed")
    return 0


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def smoke() -> int:
    if doctor() != 0:
        return 1

    nested = _run_threejs("smoke")
    if nested != 0:
        print("ERROR: embedded Three.js viewer smoke failed", file=sys.stderr)
        return nested

    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("application/javascript", ".mjs")
    handler = functools.partial(_QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    checks = (
        ("/src/client/index.html", "Hakoniwa Geo + Web3D Drone Viewer"),
        ("/src/client/src/ui.js", "createDroneViewer"),
        ("/src/client/src/frame.js", "rosToEnuFrame"),
        ("/src/client/src/mapray_layer.js", "StandardB3dProvider"),
        ("/src/client/src/collision_events.mjs", "CollisionEventTracker"),
        ("/src/client/src/terrain_height.mjs", "TerrainHeightSampler"),
        ("/src/client/src/flight_state_store.mjs", "FlightStateStore"),
        ("/src/client/src/layout_modes.mjs", "LAYOUT_MODES"),
        ("/src/client/src/location_selector.mjs", "LOCATION_CATALOG"),
        ("/src/client/src/operations_layer.mjs", "normalizeOperationsData"),
        ("/src/client/src/operations_evaluation.mjs", "PhaseDEvaluationRecorder"),
        ("/src/client/src/performance_monitor.mjs", "measurementKind"),
        ("/src/client/src/scenario_runtime.mjs", "SUPPORTED_FLEET_SIZES"),
        ("/src/client/src/wide_area_scenario.mjs", "createWideAreaScenario"),
        ("/src/client/src/scenario_config.mjs", "loadViewerScenarioConfig"),
        ("/config/viewer-config-shibuya.json", "scenarioConfigPath"),
        ("/config/viewer-config-tokyo-tower.json", "scenarioConfigPath"),
        ("/config/scenarios/shibuya.json", "coordinateContract"),
        ("/config/scenarios/tokyo-tower.json", "tokyo-tower"),
        ("/config/operations/shibuya-wide-area-5km.geojson", "shibuya-wide-area-5km"),
        ("/config/operations/tokyo-tower-wide-area-5km.geojson", "tokyo-tower-wide-area-5km"),
        ("/config/evaluation/phase-d-evaluation.json", "phase-d-mapray-leaflet"),
        ("/config/web3d-scene-shibuya.json", "terrain-grid"),
        ("/config/web3d-scene-tokyo-tower.json", "13103-bldg-lod1-latest"),
        ("/config/web3d-scene-tokyo-tower-r7-fleet-fixture.json", "Drone-AD"),
        ("/config/web3d-scene-shibuya-terrain-only.json", "terrain-grid"),
        ("/config/web3d-scene-r4-selection-fixture.json", "Drone-C"),
        ("/config/mapray.json", "5129466653179904"),
        ("/config/mapray-tokyo-tower.json", "533946"),
        ("/config/geo-origin-tokyo-tower.json", "35.658581"),
        ("/runtime-assets/shibuya/manifest.json", "maprayAbsoluteHeight"),
        ("/runtime-assets/shibuya/terrain-grid.json", "modelHeightsM"),
        ("/runtime-assets/shibuya/terrain-grid-wide-5km.json", "modelHeightsM"),
        ("/runtime-assets/shibuya/buildings.xml", "body_bldg_"),
        ("/runtime-assets/shibuya/buildings-lod1.json", '"polygons"'),
        ("/images/drone.svg", "<svg"),
        (
            "/third_party/hakoniwa-web3d-drone/src/public/drone_viewer.js",
            "createDroneViewer",
        ),
        (
            "/third_party/hakoniwa-web3d-drone/src/lod1_city_environment.js",
            "buildLod1CityEnvironment",
        ),
        (
            "/third_party/hakoniwa-web3d-drone/config/viewer-config-legacy.json",
            '"stateInput"',
        ),
        (
            "/third_party/hakoniwa-web3d-drone/thirdparty/"
            "hakoniwa-pdu-javascript/src/PduManager.js",
            "PduManager",
        ),
    )

    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        for path, marker in checks:
            with urllib.request.urlopen(base_url + path, timeout=5) as response:
                content_type = response.headers.get_content_type()
                body = response.read().decode("utf-8")
            if pathlib.PurePosixPath(path).suffix in {".js", ".mjs"}:
                if content_type != "application/javascript":
                    print(
                        f"ERROR: JavaScript MIME type is {content_type!r} for {path}",
                        file=sys.stderr,
                    )
                    return 1
            if marker not in body:
                print(
                    f"ERROR: smoke marker {marker!r} not found in {path}",
                    file=sys.stderr,
                )
                return 1
            print(f"OK: GET {path}")

        private_runtime_path = "/runtime/windows/generated/shibuya/terrain-grid.json"
        try:
            urllib.request.urlopen(base_url + private_runtime_path, timeout=5)
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
            print(f"OK: GET {private_runtime_path} is blocked (404)")
        else:
            print(
                f"ERROR: non-deployed runtime path is publicly readable: {private_runtime_path}",
                file=sys.stderr,
            )
            return 1
    except Exception as exc:  # noqa: BLE001 - CLI reports operational failures
        print(f"ERROR: integrated static-server smoke failed: {exc}", file=sys.stderr)
        return 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    print("OK: geo-viewer integrated static-server smoke passed")
    print("NOTE: WebSocket state flow and browser rendering require an E2E runtime")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Operate and validate hakoniwa-geo-viewer"
    )
    parser.add_argument("command", choices=("doctor", "test", "smoke"))
    args = parser.parse_args()

    if args.command == "doctor":
        return doctor()
    if args.command == "test":
        return test()
    return smoke()


if __name__ == "__main__":
    raise SystemExit(main())

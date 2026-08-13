from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseR7ContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_fleet_manager_module(self) -> None:
        fleet = self.read("src/client/src/fleet_manager.mjs")
        self.assertIn("export function generateFleetSyntheticData", fleet)
        self.assertIn("class FleetManager", fleet)
        self.assertIn("maxDrones", fleet)

    def test_r7_fleet_fixture_structure(self) -> None:
        fixture = json.loads(self.read("config/web3d-scene-r7-fleet-fixture.json"))
        self.assertIn("drones", fixture)
        self.assertGreaterEqual(len(fixture["drones"]), 5)

    def test_r7_benchmark_script_exists(self) -> None:
        script = (ROOT.parent / "scripts/windows/test_phase_r7_fleet_benchmark.ps1")
        self.assertTrue(script.exists(), "Phase R7 benchmark script must exist")
        actual_script = (
            ROOT.parent / "scripts/windows/run_mapray_operations_benchmark.ps1"
        )
        self.assertTrue(actual_script.exists(), "Actual browser benchmark script must exist")

    def test_ui_fleet_integration(self) -> None:
        ui = self.read("src/client/src/ui.js")
        layer = self.read("src/client/src/mapray_layer.js")
        self.assertIn("flightStateStore.updateDrones", ui)
        self.assertIn("populateDroneSelect", ui)
        self.assertIn("parseScenarioRuntimeOptions", ui)
        self.assertIn("scenarioRuntime.fleetSize", ui)
        self.assertIn("__hakoniwaDiagnostics", ui)
        self.assertIn("trajectorySampleIntervalMs", layer)
        self.assertIn("maxTrajectoryPoints", layer)

    def test_r8_runtime_contract_modules_exist(self) -> None:
        runtime = self.read("src/client/src/scenario_runtime.mjs")
        operations = self.read("src/client/src/operations_layer.mjs")
        self.assertIn("SUPPORTED_FLEET_SIZES", runtime)
        self.assertIn("10, 20, 30", runtime)
        self.assertIn("normalizeOperationsData", operations)

    def test_phase_b_performance_monitor_is_actual_measurement(self) -> None:
        monitor = self.read("src/client/src/performance_monitor.mjs")
        legacy = (
            ROOT.parent / "scripts/windows/test_phase_r7_fleet_benchmark.ps1"
        ).read_text(encoding="utf-8")
        launcher = (
            ROOT.parent / "scripts/windows/run_mapray_operations_benchmark.ps1"
        ).read_text(encoding="utf-8")
        self.assertIn("actual-browser", monitor)
        self.assertIn("estimated: false", monitor)
        self.assertIn("requestAnimationFrame", monitor)
        self.assertIn("performance.memory", monitor)
        self.assertIn("NOT_A_BENCHMARK_RESULT", legacy)
        self.assertNotIn("estimatedMaprayFps", legacy)
        self.assertIn('measurementKind = "actual-browser"', launcher)


if __name__ == "__main__":
    unittest.main()

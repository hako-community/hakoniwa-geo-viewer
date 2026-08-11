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

    def test_ui_fleet_integration(self) -> None:
        ui = self.read("src/client/src/ui.js")
        layer = self.read("src/client/src/mapray_layer.js")
        self.assertIn("flightStateStore.updateDrones", ui)
        self.assertIn("populateDroneSelect", ui)
        self.assertIn("trajectorySampleIntervalMs", layer)
        self.assertIn("maxTrajectoryPoints", layer)


if __name__ == "__main__":
    unittest.main()

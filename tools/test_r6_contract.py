from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseR6ContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_incident_scenario_module(self) -> None:
        scenario = self.read("src/client/src/incident_scenario.mjs")
        self.assertIn("export function createDisturbancePayload", scenario)
        self.assertIn("class IncidentScenarioEvaluator", scenario)
        self.assertIn("DISTURBANCE_INJECTION", scenario)

    def test_ui_incident_integration(self) -> None:
        ui = self.read("src/client/src/ui.js")
        self.assertIn("flightStateStore.addIncident", ui)
        self.assertIn("renderCollisionEvent", ui)
        self.assertIn("selectIncident", ui)

    def test_e2e_incident_script_exists(self) -> None:
        script = (ROOT.parent / "scripts/windows/test_phase_r6_incident_e2e.ps1")
        self.assertTrue(script.exists(), "Phase R6 E2E script must exist")

    def test_mapray_and_threejs_incident_selection_sync(self) -> None:
        layer = self.read("src/client/src/mapray_layer.js")
        store = self.read("src/client/src/flight_state_store.mjs")
        self.assertIn("focusIncident", layer)
        self.assertIn("selectedIncidentId", layer)
        self.assertIn("selectIncident", store)


if __name__ == "__main__":
    unittest.main()

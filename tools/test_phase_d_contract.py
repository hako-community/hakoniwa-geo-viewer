from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent


class PhaseDContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.definition = json.loads(
            (ROOT / "config/evaluation/phase-d-evaluation.json").read_text(encoding="utf-8")
        )

    def test_two_equal_type_seeded_trials_have_consistent_answers(self) -> None:
        trials = self.definition["trials"]
        self.assertEqual(len(trials), 2)
        self.assertEqual(len({trial["seed"] for trial in trials}), 2)
        self.assertEqual({trial["incident"]["type"] for trial in trials}, {"ROUTE_DEVIATION"})
        for trial in trials:
            value = trial["targetDroneIndex"] + 1
            suffix = ""
            while value > 0:
                value -= 1
                suffix = chr(ord("A") + value % 26) + suffix
                value //= 26
            expected_drone = f"Drone-{suffix}"
            self.assertEqual(trial["correct"]["droneId"], expected_drone)
            self.assertEqual(
                trial["correct"]["incidentId"],
                f"{trial['incident']['id']}-{trial['seed']}",
            )
            lon, lat, _height = trial["incident"]["coordinate"]
            self.assertGreaterEqual(lon, 139.7029)
            self.assertLessEqual(lon, 139.7096)
            self.assertGreaterEqual(lat, 35.6598)
            self.assertLessEqual(lat, 35.6652)

    def test_success_criteria_match_phase_d_plan(self) -> None:
        criteria = self.definition["successCriteria"]
        self.assertEqual(criteria["minimumParticipants"], 3)
        self.assertEqual(criteria["targetParticipants"], 5)
        self.assertEqual(criteria["locationAccuracyImprovementPoints"], 20)
        self.assertEqual(criteria["localAnalysisTimeReductionPercent"], 25)
        self.assertEqual(criteria["idIncidentIntegrityMinimumPercent"], 80)

    def test_evaluation_ui_and_tools_are_wired(self) -> None:
        html = (ROOT / "src/client/index.html").read_text(encoding="utf-8")
        ui = (ROOT / "src/client/src/ui.js").read_text(encoding="utf-8")
        hako = (ROOT / "tools/hako.py").read_text(encoding="utf-8")
        launcher = WORKSPACE / "scripts/windows/start_phase_d_evaluation.ps1"
        for marker in (
            "phase-d-evaluation-panel",
            "phase-d-answer-drone",
            "phase-d-download-csv",
        ):
            self.assertIn(marker, html)
        self.assertIn("PhaseDEvaluationRecorder", ui)
        self.assertIn("applyPhaseDTrialToGeoJson", ui)
        self.assertIn("test_operations_evaluation.mjs", hako)
        self.assertTrue(launcher.is_file())


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from phase_d_aggregate import aggregate  # noqa: E402


def row(participant: str, mode: str, *, location: bool, seconds: float, integrity: bool = True) -> dict[str, str]:
    return {
        "participant_id": participant,
        "trial_id": f"{participant}-{mode}",
        "mode": mode,
        "drone_correct": "true",
        "incident_type_correct": "true",
        "location_correct": str(location).lower(),
        "id_incident_integrity": str(integrity).lower(),
        "incident_to_completion_seconds": str(seconds + 5),
        "incident_to_local_analysis_seconds": str(seconds),
        "operation_count": "3",
        "confidence": "4",
    }


class PhaseDAggregateTest(unittest.TestCase):
    def test_success_criteria_and_minimum_participants(self) -> None:
        rows: list[dict[str, str]] = []
        for participant in ("P01", "P02", "P03"):
            rows.append(row(participant, "mapray", location=True, seconds=15))
            rows.append(row(participant, "leaflet", location=False, seconds=30))
        summary = aggregate(rows)
        self.assertEqual(summary["decision"], "MAPRAY_VALUE_PASS")
        self.assertEqual(summary["comparison"]["locationAccuracyImprovementPoints"], 100)
        self.assertEqual(summary["comparison"]["localAnalysisTimeReductionPercent"], 50)

    def test_result_is_preliminary_below_three_participants(self) -> None:
        rows = [
            row("P01", "mapray", location=True, seconds=15),
            row("P01", "leaflet", location=False, seconds=30),
        ]
        self.assertEqual(
            aggregate(rows)["decision"],
            "PRELIMINARY_PASS_NEEDS_MORE_PARTICIPANTS",
        )


if __name__ == "__main__":
    unittest.main()

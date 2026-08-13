"""Aggregate Phase D Mapray/Leaflet human-evaluation CSV files."""

from __future__ import annotations

import argparse
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Iterable


MODES = ("mapray", "leaflet")
REQUIRED_COLUMNS = {
    "measurement_kind", "estimated", "participant_id", "trial_id", "mode", "seed",
    "incident_to_completion_seconds", "incident_to_local_analysis_seconds",
    "operation_count", "confidence", "drone_correct", "incident_type_correct",
    "location_correct", "id_incident_integrity",
}


def parse_bool(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes"}


def parse_float(value: object) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number


def median(rows: list[dict[str, str]], key: str) -> float | None:
    values = [value for row in rows if (value := parse_float(row.get(key))) is not None]
    return round(statistics.median(values), 3) if values else None


def percent(rows: list[dict[str, str]], key: str) -> float | None:
    if not rows:
        return None
    return round(sum(parse_bool(row.get(key)) for row in rows) * 100 / len(rows), 3)


def discover_csv_files(inputs: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for item in inputs:
        if item.is_dir():
            files.extend(sorted(item.glob("*.csv")))
        elif item.suffix.lower() == ".csv" and item.is_file():
            files.append(item)
        else:
            raise ValueError(f"CSV input not found: {item}")
    unique = list(dict.fromkeys(path.resolve() for path in files))
    if not unique:
        raise ValueError("No CSV input files were found")
    return unique


def load_rows(paths: Iterable[Path]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    keys: set[tuple[str, str, str]] = set()
    for path in paths:
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
            if missing:
                raise ValueError(f"{path}: missing columns: {', '.join(sorted(missing))}")
            for line_number, row in enumerate(reader, start=2):
                if row.get("measurement_kind") != "actual-human-evaluation":
                    raise ValueError(f"{path}:{line_number}: measurement_kind must be actual-human-evaluation")
                if parse_bool(row.get("estimated")):
                    raise ValueError(f"{path}:{line_number}: estimated results are not accepted")
                if row.get("mode") not in MODES:
                    raise ValueError(f"{path}:{line_number}: invalid mode {row.get('mode')!r}")
                key = (row.get("participant_id", ""), row.get("trial_id", ""), row.get("mode", ""))
                if key in keys:
                    raise ValueError(f"Duplicate participant/trial/mode row: {key}")
                keys.add(key)
                rows.append(row)
    return rows


def summarize_mode(rows: list[dict[str, str]]) -> dict[str, object]:
    return {
        "trials": len(rows),
        "participants": len({row["participant_id"] for row in rows}),
        "droneAccuracyPercent": percent(rows, "drone_correct"),
        "incidentTypeAccuracyPercent": percent(rows, "incident_type_correct"),
        "locationAccuracyPercent": percent(rows, "location_correct"),
        "idIncidentIntegrityPercent": percent(rows, "id_incident_integrity"),
        "medianIncidentToCompletionSeconds": median(rows, "incident_to_completion_seconds"),
        "medianIncidentToLocalAnalysisSeconds": median(rows, "incident_to_local_analysis_seconds"),
        "medianOperationCount": median(rows, "operation_count"),
        "medianConfidence": median(rows, "confidence"),
    }


def aggregate(rows: list[dict[str, str]], criteria: dict[str, float] | None = None) -> dict[str, object]:
    criteria = criteria or {
        "minimumParticipants": 3,
        "targetParticipants": 5,
        "locationAccuracyImprovementPoints": 20,
        "localAnalysisTimeReductionPercent": 25,
        "idIncidentIntegrityMinimumPercent": 80,
    }
    by_mode = {mode: [row for row in rows if row["mode"] == mode] for mode in MODES}
    modes = {mode: summarize_mode(by_mode[mode]) for mode in MODES}
    participants_by_mode: dict[str, set[str]] = {
        mode: {row["participant_id"] for row in by_mode[mode]} for mode in MODES
    }
    paired_participants = participants_by_mode["mapray"] & participants_by_mode["leaflet"]

    mapray_location = modes["mapray"]["locationAccuracyPercent"]
    leaflet_location = modes["leaflet"]["locationAccuracyPercent"]
    location_delta = None if mapray_location is None or leaflet_location is None else round(
        float(mapray_location) - float(leaflet_location), 3
    )
    mapray_time = modes["mapray"]["medianIncidentToLocalAnalysisSeconds"]
    leaflet_time = modes["leaflet"]["medianIncidentToLocalAnalysisSeconds"]
    time_reduction = None
    if mapray_time is not None and leaflet_time not in (None, 0):
        time_reduction = round((float(leaflet_time) - float(mapray_time)) * 100 / float(leaflet_time), 3)

    all_integrity = percent(rows, "id_incident_integrity")
    location_pass = location_delta is not None and location_delta >= criteria["locationAccuracyImprovementPoints"]
    time_pass = time_reduction is not None and time_reduction >= criteria["localAnalysisTimeReductionPercent"]
    integrity_pass = all_integrity is not None and all_integrity >= criteria["idIncidentIntegrityMinimumPercent"]
    enough_participants = len(paired_participants) >= criteria["minimumParticipants"]
    if not paired_participants:
        decision = "INSUFFICIENT_DATA"
    elif (location_pass or time_pass) and integrity_pass:
        decision = "MAPRAY_VALUE_PASS" if enough_participants else "PRELIMINARY_PASS_NEEDS_MORE_PARTICIPANTS"
    else:
        decision = "NO_CLEAR_ADVANTAGE" if enough_participants else "PRELIMINARY_NO_DECISION"

    return {
        "schemaVersion": 1,
        "measurementKind": "actual-human-evaluation-summary",
        "estimated": False,
        "trialCount": len(rows),
        "participantCount": len({row["participant_id"] for row in rows}),
        "pairedParticipantCount": len(paired_participants),
        "modes": modes,
        "comparison": {
            "locationAccuracyImprovementPoints": location_delta,
            "localAnalysisTimeReductionPercent": time_reduction,
            "idIncidentIntegrityPercent": all_integrity,
        },
        "criteria": criteria,
        "criteriaResults": {
            "minimumParticipantsMet": enough_participants,
            "locationAccuracyCriterionMet": location_pass,
            "localAnalysisTimeCriterionMet": time_pass,
            "idIncidentIntegrityCriterionMet": integrity_pass,
        },
        "decision": decision,
    }


def display(value: object, suffix: str = "") -> str:
    return "n/a" if value is None else f"{value}{suffix}"


def markdown_report(summary: dict[str, object], sources: list[Path]) -> str:
    modes = summary["modes"]
    comparison = summary["comparison"]
    criteria_results = summary["criteriaResults"]
    lines = [
        "# Phase D Mapray / Leaflet A/B evaluation summary",
        "",
        f"判定: **{summary['decision']}**",
        "",
        f"評価者数: {summary['participantCount']}（両条件完了: {summary['pairedParticipantCount']}、最低3名／目標5名）",
        "",
        "| 指標 | Mapray | Leaflet |",
        "|---|---:|---:|",
        f"| 試行数 | {modes['mapray']['trials']} | {modes['leaflet']['trials']} |",
        f"| 異常機ID正答率 | {display(modes['mapray']['droneAccuracyPercent'], '%')} | {display(modes['leaflet']['droneAccuracyPercent'], '%')} |",
        f"| 異常種別正答率 | {display(modes['mapray']['incidentTypeAccuracyPercent'], '%')} | {display(modes['leaflet']['incidentTypeAccuracyPercent'], '%')} |",
        f"| 地点正答率 | {display(modes['mapray']['locationAccuracyPercent'], '%')} | {display(modes['leaflet']['locationAccuracyPercent'], '%')} |",
        f"| 異常→局所解析 中央値 | {display(modes['mapray']['medianIncidentToLocalAnalysisSeconds'], ' s')} | {display(modes['leaflet']['medianIncidentToLocalAnalysisSeconds'], ' s')} |",
        f"| 操作数 中央値 | {display(modes['mapray']['medianOperationCount'])} | {display(modes['leaflet']['medianOperationCount'])} |",
        f"| ID整合率 | {display(modes['mapray']['idIncidentIntegrityPercent'], '%')} | {display(modes['leaflet']['idIncidentIntegrityPercent'], '%')} |",
        "",
        "## 成功基準",
        "",
        f"- 地点正答率差: {display(comparison['locationAccuracyImprovementPoints'], ' pt')}（20 pt以上: {'達成' if criteria_results['locationAccuracyCriterionMet'] else '未達'}）",
        f"- 局所解析時間短縮: {display(comparison['localAnalysisTimeReductionPercent'], '%')}（25%以上: {'達成' if criteria_results['localAnalysisTimeCriterionMet'] else '未達'}）",
        f"- ID・インシデント整合率: {display(comparison['idIncidentIntegrityPercent'], '%')}（80%以上: {'達成' if criteria_results['idIncidentIntegrityCriterionMet'] else '未達'}）",
        "",
        "## 入力証跡",
        "",
    ]
    lines.extend(f"- `{path}`" for path in sources)
    lines.append("")
    return "\n".join(lines)


def svg_report(summary: dict[str, object]) -> str:
    modes = summary["modes"]
    metrics = [
        ("Location accuracy (%)", modes["mapray"]["locationAccuracyPercent"], modes["leaflet"]["locationAccuracyPercent"], 100),
        ("ID integrity (%)", modes["mapray"]["idIncidentIntegrityPercent"], modes["leaflet"]["idIncidentIntegrityPercent"], 100),
        ("Incident to local (s)", modes["mapray"]["medianIncidentToLocalAnalysisSeconds"], modes["leaflet"]["medianIncidentToLocalAnalysisSeconds"], None),
        ("Operations", modes["mapray"]["medianOperationCount"], modes["leaflet"]["medianOperationCount"], None),
    ]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="430" viewBox="0 0 900 430">',
        '<rect width="900" height="430" fill="#ffffff"/>',
        '<style>text{font-family:Segoe UI,Arial,sans-serif;fill:#1f2937}.t{font-size:22px;font-weight:700}.l{font-size:14px}.v{font-size:12px}</style>',
        '<text x="30" y="36" class="t">Phase D Mapray / Leaflet A/B comparison</text>',
        '<rect x="650" y="18" width="16" height="16" fill="#2563eb"/><text x="674" y="31" class="l">Mapray</text>',
        '<rect x="760" y="18" width="16" height="16" fill="#f59e0b"/><text x="784" y="31" class="l">Leaflet</text>',
    ]
    for index, (label, mapray_value, leaflet_value, fixed_max) in enumerate(metrics):
        y = 78 + index * 85
        values = [float(value or 0) for value in (mapray_value, leaflet_value)]
        maximum = float(fixed_max or max(values + [1]))
        parts.append(f'<text x="30" y="{y}" class="l">{label}</text>')
        for offset, (value, color) in enumerate(zip(values, ("#2563eb", "#f59e0b"))):
            bar_y = y + 12 + offset * 24
            width = round(680 * value / maximum, 2)
            parts.append(f'<rect x="170" y="{bar_y}" width="{width}" height="17" rx="2" fill="{color}"/>')
            parts.append(f'<text x="{180 + width}" y="{bar_y + 13}" class="v">{value:g}</text>')
    parts.append(f'<text x="30" y="415" class="l">Decision: {summary["decision"]}</text>')
    parts.append('</svg>')
    return "\n".join(parts)


def write_outputs(summary: dict[str, object], output_dir: Path, sources: list[Path]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "phase-d-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "phase-d-summary.md").write_text(
        markdown_report(summary, sources), encoding="utf-8"
    )
    (output_dir / "phase-d-comparison.svg").write_text(
        svg_report(summary), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path, help="CSV files or directories")
    parser.add_argument("--output-dir", type=Path, default=Path("phase-d-results"))
    args = parser.parse_args()
    sources = discover_csv_files(args.inputs)
    summary = aggregate(load_rows(sources))
    write_outputs(summary, args.output_dir, sources)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

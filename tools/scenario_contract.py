#!/usr/bin/env python3
"""Validate deployed viewer assets and the R1 coordinate/height contract."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "runtime-assets" / "shibuya"
EXPECTED_FRAME = "mujoco_x_north_y_minus_east_z_up"


class ScenarioContractError(ValueError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _finite(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ScenarioContractError(f"{label} must be numeric") from exc
    if not math.isfinite(number):
        raise ScenarioContractError(f"{label} must be finite")
    return number


def validate_terrain_grid(data: dict[str, Any]) -> dict[str, Any]:
    if data.get("schemaVersion") != 1:
        raise ScenarioContractError("unsupported terrain-grid schemaVersion")
    if data.get("frame") != EXPECTED_FRAME:
        raise ScenarioContractError("terrain-grid frame mismatch")
    rows = data.get("rows")
    columns = data.get("columns")
    if not isinstance(rows, int) or isinstance(rows, bool) or rows < 2:
        raise ScenarioContractError("terrain-grid rows must be an integer >= 2")
    if not isinstance(columns, int) or isinstance(columns, bool) or columns < 2:
        raise ScenarioContractError("terrain-grid columns must be an integer >= 2")
    x_min = _finite(data.get("xMinM"), "xMinM")
    x_max = _finite(data.get("xMaxM"), "xMaxM")
    y_min = _finite(data.get("yMinM"), "yMinM")
    y_max = _finite(data.get("yMaxM"), "yMaxM")
    _finite(data.get("zBaselineM"), "zBaselineM")
    if x_min >= x_max or y_min >= y_max:
        raise ScenarioContractError("terrain-grid bounds must be increasing")
    heights = data.get("modelHeightsM")
    if not isinstance(heights, list) or len(heights) != rows * columns:
        raise ScenarioContractError("terrain-grid modelHeightsM length mismatch")
    for index, value in enumerate(heights):
        _finite(value, f"modelHeightsM[{index}]")
    return data


def sample_model_height(grid: dict[str, Any], x_m: float, y_m: float) -> float:
    x_min = float(grid["xMinM"])
    x_max = float(grid["xMaxM"])
    y_min = float(grid["yMinM"])
    y_max = float(grid["yMaxM"])
    rows = int(grid["rows"])
    columns = int(grid["columns"])
    x = _finite(x_m, "sample x")
    y = _finite(y_m, "sample y")
    if x < x_min or x > x_max or y < y_min or y > y_max:
        raise ScenarioContractError("sample lies outside terrain-grid bounds")
    column_value = (x - x_min) / (x_max - x_min) * (columns - 1)
    row_value = (y - y_min) / (y_max - y_min) * (rows - 1)
    column = min(math.floor(column_value), columns - 2)
    row = min(math.floor(row_value), rows - 2)
    dx = column_value - column
    dy = row_value - row
    heights = grid["modelHeightsM"]

    def at(r: int, c: int) -> float:
        return float(heights[r * columns + c])

    return (
        at(row, column) * (1 - dx) * (1 - dy)
        + at(row, column + 1) * dx * (1 - dy)
        + at(row + 1, column) * (1 - dx) * dy
        + at(row + 1, column + 1) * dx * dy
    )


def build_nine_point_report(
    grid: dict[str, Any], terrain_source_manifest: dict[str, Any]
) -> list[dict[str, float]]:
    samples = terrain_source_manifest.get("mujoco_validation", {}).get("samples")
    if not isinstance(samples, list) or len(samples) != 9:
        raise ScenarioContractError("terrain source manifest must contain 9 MuJoCo samples")
    baseline = float(grid["zBaselineM"])
    report: list[dict[str, float]] = []
    for sample in samples:
        x_m = _finite(sample.get("x_m"), "MuJoCo sample x_m")
        y_m = _finite(sample.get("y_m"), "MuJoCo sample y_m")
        three_height = sample_model_height(grid, x_m, y_m)
        expected_height = _finite(
            sample.get("expected_height_m"), "MuJoCo expected_height_m"
        )
        mujoco_height = _finite(sample.get("mujoco_height_m"), "mujoco_height_m")
        if abs(three_height - expected_height) > 0.001:
            raise ScenarioContractError(
                f"Three.js/grid height differs from source at ({x_m}, {y_m})"
            )
        if abs(mujoco_height - three_height) > 0.001:
            raise ScenarioContractError(
                f"MuJoCo height differs from Three.js/grid at ({x_m}, {y_m})"
            )
        report.append(
            {
                "xM": x_m,
                "yM": y_m,
                "mujocoModelHeightM": mujoco_height,
                "threeModelHeightM": three_height,
                "maprayAbsoluteHeightM": three_height + baseline,
                "zBaselineM": baseline,
            }
        )
    return report


def validate_runtime_assets(asset_root: Path = ASSET_ROOT) -> dict[str, Any]:
    manifest_path = asset_root / "manifest.json"
    if not manifest_path.is_file():
        raise ScenarioContractError(f"runtime manifest is missing: {manifest_path}")
    manifest = load_json(manifest_path)
    if manifest.get("schemaVersion") != 1 or manifest.get("scenarioId") != "shibuya":
        raise ScenarioContractError("runtime manifest identity mismatch")
    contract = manifest.get("coordinateContract", {})
    if contract.get("frame") != EXPECTED_FRAME:
        raise ScenarioContractError("runtime manifest coordinate frame mismatch")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ScenarioContractError("runtime manifest files must not be empty")
    verified: list[str] = []
    for item in files:
        relative = PurePosixPath(str(item.get("path", "")))
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise ScenarioContractError(f"unsafe runtime asset path: {relative}")
        target = asset_root.joinpath(*relative.parts).resolve()
        if not target.is_relative_to(asset_root.resolve()) or not target.is_file():
            raise ScenarioContractError(f"runtime asset is missing: {relative}")
        if target.stat().st_size != int(item.get("bytes", -1)):
            raise ScenarioContractError(f"runtime asset size mismatch: {relative}")
        if sha256(target) != str(item.get("sha256", "")).lower():
            raise ScenarioContractError(f"runtime asset hash mismatch: {relative}")
        verified.append(relative.as_posix())

    grid = validate_terrain_grid(load_json(asset_root / "terrain-grid.json"))
    for key in ("rows", "columns", "xMinM", "xMaxM", "yMinM", "yMaxM", "zBaselineM"):
        if float(contract[key]) != float(grid[key]):
            raise ScenarioContractError(f"runtime manifest/grid mismatch: {key}")
    terrain_source = load_json(asset_root / "terrain-source-manifest.json")
    samples = build_nine_point_report(grid, terrain_source)
    return {
        "manifest": manifest,
        "grid": grid,
        "verifiedFiles": verified,
        "samples": samples,
    }


def main() -> int:
    result = validate_runtime_assets()
    print(f"verified runtime files: {len(result['verifiedFiles'])}")
    print("x[m]    y[m]    MuJoCo Z   Three.js Z   Mapray absolute Z")
    for sample in result["samples"]:
        print(
            f"{sample['xM']:7.1f} {sample['yM']:7.1f} "
            f"{sample['mujocoModelHeightM']:10.4f} "
            f"{sample['threeModelHeightM']:12.4f} "
            f"{sample['maprayAbsoluteHeightM']:17.4f}"
        )
    print("scenario contract: PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

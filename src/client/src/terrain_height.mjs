function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function validateTerrainGrid(data) {
  if (!data || data.schemaVersion !== 1) {
    throw new Error('Unsupported browser terrain-grid schema');
  }
  if (data.frame !== 'mujoco_x_north_y_minus_east_z_up') {
    throw new Error('Unsupported browser terrain-grid frame');
  }
  const rows = Number(data.rows);
  const columns = Number(data.columns);
  const bounds = [data.xMinM, data.xMaxM, data.yMinM, data.yMaxM, data.zBaselineM]
    .map(Number);
  if (
    !Number.isInteger(rows)
    || !Number.isInteger(columns)
    || rows < 2
    || columns < 2
    || !bounds.every(Number.isFinite)
    || bounds[0] >= bounds[1]
    || bounds[2] >= bounds[3]
    || !Array.isArray(data.modelHeightsM)
    || data.modelHeightsM.length !== rows * columns
    || !data.modelHeightsM.every((value) => Number.isFinite(Number(value)))
  ) {
    throw new Error('Invalid browser terrain grid');
  }
  return data;
}

export class TerrainHeightSampler {
  constructor(data) {
    validateTerrainGrid(data);
    this.rows = Number(data.rows);
    this.columns = Number(data.columns);
    this.xMinM = finite(data.xMinM);
    this.xMaxM = finite(data.xMaxM);
    this.yMinM = finite(data.yMinM);
    this.yMaxM = finite(data.yMaxM);
    this.heights = data.modelHeightsM;
    this.zBaselineM = Number(data.zBaselineM);
  }

  sample(xM, yM) {
    const x = Number(xM);
    const y = Number(yM);
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || x < this.xMinM
      || x > this.xMaxM
      || y < this.yMinM
      || y > this.yMaxM
    ) {
      return null;
    }
    const columnValue = (x - this.xMinM) / (this.xMaxM - this.xMinM) * (this.columns - 1);
    const rowValue = (y - this.yMinM) / (this.yMaxM - this.yMinM) * (this.rows - 1);
    const column = Math.min(Math.floor(columnValue), this.columns - 2);
    const row = Math.min(Math.floor(rowValue), this.rows - 2);
    const dx = columnValue - column;
    const dy = rowValue - row;
    const at = (r, c) => finite(this.heights[r * this.columns + c]);
    return (
      at(row, column) * (1 - dx) * (1 - dy)
      + at(row, column + 1) * dx * (1 - dy)
      + at(row + 1, column) * (1 - dx) * dy
      + at(row + 1, column + 1) * dx * dy
    );
  }
}

export async function loadTerrainHeightSampler(url) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Terrain grid load failed: ${url}`);
  return new TerrainHeightSampler(await response.json());
}

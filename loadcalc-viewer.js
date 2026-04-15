const state = {
  rows: [],
  header: [],
  selectedSeries: new Set(),
  sampleStep: 30,
  hoveredIndex: -1,
  seriesMeta: new Map(),
};

const colors = [
  "#9d3d2f",
  "#c98f2b",
  "#27606b",
  "#5e7c3f",
  "#6b4e9d",
  "#2d7d7d",
  "#b85c38",
  "#304d8d",
];

const presets = {
  currents: [
    "load_calc_phase_a_current_avg",
    "load_calc_phase_b_current_avg",
    "load_calc_phase_c_current_avg",
    "load_calc_total_current_reference_1",
  ],
  power: [
    "load_calc_phase_a_kw_avg",
    "load_calc_phase_b_kw_avg",
    "load_calc_phase_c_kw_avg",
    "load_calc_total_kw_avg",
  ],
  frequency: [
    "load_calc_frequency_min",
    "load_calc_frequency_avg",
    "load_calc_frequency_max",
  ],
  references: [
    "load_calc_phase_a_kw_reference",
    "load_calc_phase_b_kw_reference",
    "load_calc_phase_c_kw_reference",
    "load_calc_total_kw_reference",
  ],
};

const elements = {
  fileInput: document.querySelector("#file-input"),
  sampleStep: document.querySelector("#sample-step"),
  sampleStepValue: document.querySelector("#sample-step-value"),
  seriesFilter: document.querySelector("#series-filter"),
  seriesList: document.querySelector("#series-list"),
  chartCanvas: document.querySelector("#chart-canvas"),
  tooltip: document.querySelector("#tooltip"),
  chartTitle: document.querySelector("#chart-title"),
  chartSubtitle: document.querySelector("#chart-subtitle"),
  insights: document.querySelector("#insights"),
  statStatus: document.querySelector("#stat-status"),
  statRows: document.querySelector("#stat-rows"),
  statSampled: document.querySelector("#stat-sampled"),
  statRange: document.querySelector("#stat-range"),
  clearSelection: document.querySelector("#clear-selection"),
  presetButtons: [...document.querySelectorAll(".preset-button")],
};

const ctx = elements.chartCanvas.getContext("2d");

elements.sampleStep.addEventListener("input", () => {
  state.sampleStep = Number(elements.sampleStep.value);
  elements.sampleStepValue.textContent = String(state.sampleStep);
});

elements.sampleStep.addEventListener("change", async () => {
  if (elements.fileInput.files[0]) {
    await loadCsv(elements.fileInput.files[0]);
  }
});

elements.fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  await loadCsv(file);
});

elements.seriesFilter.addEventListener("input", renderSeriesList);

elements.clearSelection.addEventListener("click", () => {
  state.selectedSeries.clear();
  renderSeriesList();
  drawChart();
  renderInsights();
});

elements.presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const preset = presets[button.dataset.preset] || [];
    state.selectedSeries = new Set(preset.filter((key) => state.header.includes(key)));
    renderSeriesList();
    drawChart();
    renderInsights();
  });
});

elements.chartCanvas.addEventListener("mousemove", (event) => {
  const rows = state.rows;
  if (!rows.length || !state.selectedSeries.size) {
    elements.tooltip.hidden = true;
    return;
  }

  const rect = elements.chartCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const plot = getPlotArea();
  if (x < plot.left || x > plot.right) {
    elements.tooltip.hidden = true;
    return;
  }

  const ratio = (x - plot.left) / Math.max(1, plot.right - plot.left);
  state.hoveredIndex = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
  drawChart();
});

elements.chartCanvas.addEventListener("mouseleave", () => {
  state.hoveredIndex = -1;
  elements.tooltip.hidden = true;
  drawChart();
});

window.addEventListener("resize", drawChart);

function setStatus(text) {
  elements.statStatus.textContent = text;
}

async function loadCsv(file) {
  state.rows = [];
  state.header = [];
  state.seriesMeta.clear();
  state.selectedSeries.clear();
  state.hoveredIndex = -1;
  setStatus("Reading CSV...");
  elements.statRows.textContent = "0";
  elements.statSampled.textContent = "0";
  elements.statRange.textContent = "-";
  elements.chartSubtitle.textContent = "Parsing and downsampling the CSV for plotting.";
  renderSeriesList();
  drawChart();
  renderInsights();

  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let rowIndex = 0;
  let sampled = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      if (!state.header.length) {
        state.header = parseCsvLine(line);
        initializeSeriesMeta();
        renderSeriesList();
        continue;
      }

      rowIndex += 1;
      if ((rowIndex - 1) % state.sampleStep !== 0) {
        continue;
      }

      const cells = parseCsvLine(line);
      const row = rowFromCells(cells);
      if (row) {
        state.rows.push(row);
        sampled += 1;
      }
    }
    elements.statRows.textContent = rowIndex.toLocaleString();
    elements.statSampled.textContent = sampled.toLocaleString();
  }

  if (buffer.trim()) {
    if (!state.header.length) {
      state.header = parseCsvLine(buffer);
      initializeSeriesMeta();
    } else {
      rowIndex += 1;
      if ((rowIndex - 1) % state.sampleStep === 0) {
        const row = rowFromCells(parseCsvLine(buffer));
        if (row) {
          state.rows.push(row);
          sampled += 1;
        }
      }
    }
  }

  elements.statRows.textContent = rowIndex.toLocaleString();
  elements.statSampled.textContent = sampled.toLocaleString();

  const defaultPreset = presets.currents.filter((key) => state.header.includes(key));
  state.selectedSeries = new Set(defaultPreset);

  updateRangeStats();
  setStatus(`Loaded ${file.name}`);
  elements.chartSubtitle.textContent = `Showing every ${state.sampleStep} row(s) from ${file.name}.`;
  renderSeriesList();
  drawChart();
  renderInsights();
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function initializeSeriesMeta() {
  state.header.forEach((name, index) => {
    state.seriesMeta.set(name, {
      index,
      color: colors[index % colors.length],
    });
  });
}

function rowFromCells(cells) {
  const row = { raw: cells };
  row.time = cells[state.header.indexOf("started_at_utc")] || "";
  for (let i = 0; i < state.header.length; i += 1) {
    const key = state.header[i];
    if (key === "started_at_utc" || key === "ended_at_utc") {
      row[key] = cells[i];
    } else if (key === "record_index" || key === "offset") {
      row[key] = Number(cells[i]);
    } else {
      const value = cells[i];
      row[key] = value === "" ? null : Number(value);
    }
  }
  return row;
}

function renderSeriesList() {
  const filter = elements.seriesFilter.value.trim().toLowerCase();
  const series = state.header.filter((name) => {
    if (["record_index", "offset", "started_at_utc", "ended_at_utc"].includes(name)) {
      return false;
    }
    return !filter || name.toLowerCase().includes(filter);
  });

  elements.seriesList.innerHTML = "";

  if (!series.length) {
    elements.seriesList.innerHTML = '<div class="series-meta">No matching series.</div>';
    return;
  }

  for (const name of series) {
    const id = `series-${name}`;
    const wrapper = document.createElement("div");
    wrapper.className = "series-option";
    const meta = state.seriesMeta.get(name) || { color: colors[0] };
    const checked = state.selectedSeries.has(name);

    wrapper.innerHTML = `
      <input id="${id}" type="checkbox" ${checked ? "checked" : ""}>
      <label for="${id}">
        <span class="series-name">${name}</span>
        <span class="series-meta" style="color:${meta.color}">Line color ${meta.color}</span>
      </label>
    `;

    wrapper.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedSeries.add(name);
      } else {
        state.selectedSeries.delete(name);
      }
      drawChart();
      renderInsights();
    });

    elements.seriesList.appendChild(wrapper);
  }
}

function updateRangeStats() {
  if (!state.rows.length) {
    elements.statRange.textContent = "-";
    return;
  }
  const first = state.rows[0].started_at_utc;
  const last = state.rows[state.rows.length - 1].started_at_utc;
  elements.statRange.textContent = `${shortTime(first)} to ${shortTime(last)}`;
}

function getSelectedSeries() {
  return [...state.selectedSeries].filter((name) => state.header.includes(name));
}

function getPlotArea() {
  const canvas = elements.chartCanvas;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return {
    width: cssWidth,
    height: cssHeight,
    top: 36,
    right: cssWidth - 24,
    bottom: cssHeight - 54,
    left: 72,
  };
}

function drawChart() {
  const plot = getPlotArea();
  ctx.clearRect(0, 0, plot.width, plot.height);

  drawChartFrame(plot);

  const selected = getSelectedSeries();
  if (!state.rows.length || !selected.length) {
    drawEmptyState(plot);
    return;
  }

  const values = [];
  for (const name of selected) {
    for (const row of state.rows) {
      const value = row[name];
      if (Number.isFinite(value)) {
        values.push(value);
      }
    }
  }

  if (!values.length) {
    drawEmptyState(plot);
    return;
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  drawGrid(plot, min, max);

  selected.forEach((name, seriesIndex) => {
    const color = (state.seriesMeta.get(name) || {}).color || colors[seriesIndex % colors.length];
    drawSeries(plot, name, color, min, max);
  });

  drawAxesLabels(plot, min, max);
  drawLegend(plot, selected);

  if (state.hoveredIndex >= 0 && state.hoveredIndex < state.rows.length) {
    drawHover(plot, selected, min, max);
  }
}

function drawChartFrame(plot) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.64)";
  ctx.fillRect(0, 0, plot.width, plot.height);
  ctx.restore();
}

function drawEmptyState(plot) {
  ctx.save();
  ctx.fillStyle = "#6a5a41";
  ctx.font = '600 18px Georgia, "Times New Roman", serif';
  ctx.textAlign = "center";
  ctx.fillText("Load a CSV and select at least one series to draw the chart.", plot.width / 2, plot.height / 2);
  ctx.restore();
}

function drawGrid(plot, min, max) {
  ctx.save();
  ctx.strokeStyle = "rgba(79, 63, 39, 0.12)";
  ctx.lineWidth = 1;
  const steps = 5;
  for (let i = 0; i <= steps; i += 1) {
    const y = plot.top + ((plot.bottom - plot.top) / steps) * i;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }
  const xSteps = 6;
  for (let i = 0; i <= xSteps; i += 1) {
    const x = plot.left + ((plot.right - plot.left) / xSteps) * i;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAxesLabels(plot, min, max) {
  ctx.save();
  ctx.fillStyle = "#6a5a41";
  ctx.font = '12px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "right";
  const steps = 5;
  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    const value = max - ratio * (max - min);
    const y = plot.top + ((plot.bottom - plot.top) / steps) * i + 4;
    ctx.fillText(formatMetric(value), plot.left - 10, y);
  }

  ctx.textAlign = "center";
  const xSteps = 4;
  for (let i = 0; i <= xSteps; i += 1) {
    const index = Math.min(state.rows.length - 1, Math.round((state.rows.length - 1) * (i / xSteps)));
    const x = plot.left + ((plot.right - plot.left) / xSteps) * i;
    ctx.fillText(shortTime(state.rows[index].started_at_utc), x, plot.bottom + 24);
  }
  ctx.restore();
}

function drawSeries(plot, name, color, min, max) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  let started = false;
  state.rows.forEach((row, index) => {
    const value = row[name];
    if (!Number.isFinite(value)) {
      return;
    }
    const x = plot.left + (index / Math.max(1, state.rows.length - 1)) * (plot.right - plot.left);
    const y = plot.bottom - ((value - min) / (max - min)) * (plot.bottom - plot.top);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
}

function drawLegend(plot, selected) {
  ctx.save();
  let x = plot.left;
  let y = 14;
  selected.forEach((name, index) => {
    const color = (state.seriesMeta.get(name) || {}).color || colors[index % colors.length];
    const textWidth = ctx.measureText(name).width;
    if (x + textWidth + 44 > plot.right) {
      x = plot.left;
      y += 20;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 8, 14, 4);
    ctx.fillStyle = "#2f2415";
    ctx.font = '12px "SFMono-Regular", Consolas, monospace';
    ctx.fillText(name, x + 20, y);
    x += textWidth + 40;
  });
  ctx.restore();
}

function drawHover(plot, selected, min, max) {
  const row = state.rows[state.hoveredIndex];
  const x = plot.left + (state.hoveredIndex / Math.max(1, state.rows.length - 1)) * (plot.right - plot.left);
  ctx.save();
  ctx.strokeStyle = "rgba(45, 34, 20, 0.18)";
  ctx.beginPath();
  ctx.moveTo(x, plot.top);
  ctx.lineTo(x, plot.bottom);
  ctx.stroke();

  selected.forEach((name, index) => {
    const value = row[name];
    if (!Number.isFinite(value)) {
      return;
    }
    const y = plot.bottom - ((value - min) / (max - min)) * (plot.bottom - plot.top);
    const color = (state.seriesMeta.get(name) || {}).color || colors[index % colors.length];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  elements.tooltip.hidden = false;
  elements.tooltip.style.left = `${x}px`;
  elements.tooltip.style.top = `${Math.max(plot.top + 20, plot.top + (plot.bottom - plot.top) * 0.28)}px`;
  elements.tooltip.innerHTML = `
    <div class="tooltip-time">${row.started_at_utc}</div>
    ${selected
      .map((name) => {
        const color = (state.seriesMeta.get(name) || {}).color || colors[0];
        const value = row[name];
        return `<div><span style="color:${color}">&#9632;</span> ${name}: ${Number.isFinite(value) ? formatMetric(value) : "n/a"}</div>`;
      })
      .join("")}
  `;
}

function renderInsights() {
  const selected = getSelectedSeries();
  if (!state.rows.length || !selected.length) {
    elements.insights.innerHTML = '<div class="insights-empty">No series selected yet.</div>';
    return;
  }

  const cards = selected.map((name) => {
    const values = state.rows.map((row) => row[name]).filter(Number.isFinite);
    if (!values.length) {
      return "";
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return `
      <div class="insight-card">
        <strong>${name}</strong>
        <span>Min: ${formatMetric(min)}</span>
        <span>Avg: ${formatMetric(avg)}</span>
        <span>Max: ${formatMetric(max)}</span>
      </div>
    `;
  }).join("");

  elements.insights.innerHTML = `<div class="insight-grid">${cards}</div>`;
}

function formatMetric(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function shortTime(value) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").replace("+00:00", " UTC").slice(0, 16);
}

drawChart();

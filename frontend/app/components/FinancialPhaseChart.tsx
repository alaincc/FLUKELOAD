"use client";

import InteractiveSeriesChart from "./InteractiveSeriesChart";

type ParserRow = {
  record_index: number;
  started_at_utc: string;
  ended_at_utc: string;
  [key: string]: string | number | null;
};

type PhaseKey = "phase_a" | "phase_b" | "phase_c";

type Props = {
  rows: ParserRow[];
  phaseVisibility: Record<PhaseKey, boolean>;
};

const PHASE_SERIES: Array<{
  key: PhaseKey;
  field: string;
  label: string;
  color: string;
}> = [
  { key: "phase_a", field: "load_calc_phase_a_current_avg", label: "Phase A", color: "#b5402a" },
  { key: "phase_b", field: "load_calc_phase_b_current_avg", label: "Phase B", color: "#2f6fdf" },
  { key: "phase_c", field: "load_calc_phase_c_current_avg", label: "Phase C", color: "#2f8a57" },
];

export default function FinancialPhaseChart({ rows, phaseVisibility }: Props) {
  const series = PHASE_SERIES.filter((item) => phaseVisibility[item.key]).map((item) => ({
    name: item.label,
    color: item.color,
    values: rows.map((row) =>
      typeof row[item.field] === "number" ? (row[item.field] as number) : null,
    ),
  }));

  return (
    <div style={{ width: "100%", minWidth: 0, display: "block" }}>
      <InteractiveSeriesChart rows={rows} series={series} yAxisLabel="Current / power" />
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildClientDashboardHtml } from "./client-export";
import { buildLoadStudyReportHtml } from "./report";

type ParserField = {
  name: string;
  confidence: string;
  note: string;
};

type ParserRow = {
  record_index: number;
  started_at_utc: string;
  ended_at_utc: string;
  [key: string]: string | number | null;
};

type ParserResponse = {
  meta: {
    header_bytes: number;
    record_size_bytes: number;
    record_count: number;
    trailing_bytes: number;
    sample_step: number;
    effective_sample_step?: number;
    plotted_points: number;
    first_record_start: string | null;
    last_record_end: string | null;
    study_start_at?: string | null;
    study_end_at?: string | null;
  };
  fields: ParserField[];
  rows: ParserRow[];
  series: Record<string, Array<number | null>>;
  saved_session?: SavedSession;
};

type SavedSession = {
  id: string;
  original_filename: string;
  file_sha256: string;
  sample_step: number;
  max_points: number;
  cached_at_utc: string;
  cache_hit: boolean;
};

type SavedSessionSummary = {
  id: string;
  original_filename: string;
  file_sha256: string;
  sample_step: number;
  max_points: number;
  cached_at_utc: string;
  record_count: number;
  plotted_points: number;
  first_record_start: string | null;
  last_record_end: string | null;
  study_start_at?: string | null;
  study_end_at?: string | null;
};

type ClientExportResponse = {
  generated_at_utc: string;
  export_directory: string;
  pdf_generated: boolean;
  pdf_error: string | null;
  files: {
    dashboard_html: string;
    report_html: string;
    analysis_json: string;
    report_pdf: string | null;
  };
};

const PRESETS: Record<string, string[]> = {
  currents: [
    "load_calc_phase_a_current_avg",
    "load_calc_phase_b_current_avg",
    "load_calc_phase_c_current_avg",
    "load_calc_total_current_reference_1",
  ],
  voltage: [
    "load_calc_nominal_ln_voltage_a",
    "load_calc_nominal_ln_voltage_b",
    "load_calc_nominal_ln_voltage_c",
    "load_calc_nominal_ll_voltage_ab",
    "load_calc_nominal_ll_voltage_bc",
    "load_calc_nominal_ll_voltage_ca",
  ],
  kw: [
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

const COLORS = ["#a03f32", "#cf9334", "#2f6874", "#668943", "#6f58a8", "#2f7d7d"];
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

const PHASE_KEYS = ["phase_a", "phase_b", "phase_c"] as const;
const PHASE_META = {
  phase_a: { label: "Phase A", color: "#b5402a" },
  phase_b: { label: "Phase B", color: "#2f6fdf" },
  phase_c: { label: "Phase C", color: "#2f8a57" },
} as const;
const TIME_PRESET_OPTIONS = [
  { value: "study", label: "Study" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
] as const;

type TimePreset = (typeof TIME_PRESET_OPTIONS)[number]["value"];

const InteractiveSeriesChart = dynamic(() => import("./components/InteractiveSeriesChart"), {
  ssr: false,
});

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSeriesDrawerOpen, setIsSeriesDrawerOpen] = useState(false);
  const [sampleStep, setSampleStep] = useState(30);
  const [maxPoints, setMaxPoints] = useState(8000);
  const [clientName, setClientName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [data, setData] = useState<ParserResponse | null>(null);
  const [status, setStatus] = useState("Waiting for .fel file");
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [windowRange, setWindowRange] = useState<[number, number]>([0, 1]);
  const [savedSessions, setSavedSessions] = useState<SavedSessionSummary[]>([]);
  const [savedSessionsStatus, setSavedSessionsStatus] = useState("Loading saved sessions...");
  const [reportPreviewHtml, setReportPreviewHtml] = useState<string | null>(null);
  const [isExportingClient, setIsExportingClient] = useState(false);
  const [lastClientExport, setLastClientExport] = useState<ClientExportResponse | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [combinedTimePreset, setCombinedTimePreset] = useState<TimePreset>("study");
  const [combinedAnchorDate, setCombinedAnchorDate] = useState("");
  const [phaseVisibility, setPhaseVisibility] = useState<Record<(typeof PHASE_KEYS)[number], boolean>>({
    phase_a: true,
    phase_b: true,
    phase_c: true,
  });

  const deferredFilter = useDeferredValue(filter);
  const reportFrameRef = useRef<HTMLIFrameElement | null>(null);
  const autoLoadedSessionRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const sessions = await refreshSavedSessions();
      if (!autoLoadedSessionRef.current && sessions.length) {
        autoLoadedSessionRef.current = true;
        await handleLoadSaved(sessions[0].id, sessions[0].original_filename);
      }
    })();
  }, []);

  const filteredFields = useMemo(() => {
    if (!data) return [];
    return data.fields.filter((field) =>
      field.name.toLowerCase().includes(deferredFilter.toLowerCase()),
    );
  }, [data, deferredFilter]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    const [start, end] = windowRange;
    const maxIndex = data.rows.length - 1;
    const from = Math.max(0, Math.min(maxIndex, Math.floor(start * maxIndex)));
    const to = Math.max(from + 1, Math.min(maxIndex, Math.ceil(end * maxIndex)));
    return data.rows.slice(from, to + 1);
  }, [data, windowRange]);

  const selectedSeries = useMemo(() => {
    if (!data) return [];
    return selected
      .filter((name) => data.series[name])
      .map((name, index) => ({
        name,
        color: COLORS[index % COLORS.length],
        values: visibleRows.map((row) => row[name] as number | null),
      }));
  }, [data, selected, visibleRows]);
  const combinedScoped = useMemo(
    () => applyTimePresetToRows(visibleRows, combinedTimePreset, combinedAnchorDate),
    [visibleRows, combinedTimePreset, combinedAnchorDate],
  );
  const combinedRows = combinedScoped.rows;
  const combinedDateBounds = useMemo(() => getStudyDateBounds(visibleRows), [visibleRows]);

  function applyParsedData(parsed: ParserResponse, nextStatus: string) {
    startTransition(() => {
      setData(parsed);
      setSelected(
        [...PRESETS.currents, ...PRESETS.voltage].filter((name) => parsed.series[name]),
      );
      setWindowRange([0, 1]);
      setStatus(nextStatus);
      setIsDrawerOpen(false);
      setIsSeriesDrawerOpen(false);
    });
  }

  async function refreshSavedSessions() {
    setSavedSessionsStatus("Loading saved sessions...");
    try {
      const response = await fetch(`${API_BASE_URL}/api/saved-sessions`);
      if (!response.ok) {
        setSavedSessionsStatus("Could not load saved sessions");
        return [];
      }
      const payload = (await response.json()) as { sessions: SavedSessionSummary[] };
      setSavedSessions(payload.sessions);
      setSavedSessionsStatus(
        payload.sessions.length
          ? `${payload.sessions.length} saved session${payload.sessions.length === 1 ? "" : "s"} available`
          : "No saved sessions yet",
      );
      return payload.sessions;
    } catch {
      setSavedSessionsStatus("Saved sessions are unavailable right now");
      return [];
    }
  }

  async function handleUpload() {
    if (!file || isUploading) return;
    setStatus("Uploading and parsing .fel...");
    setIsUploading(true);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sample_step", String(sampleStep));
      form.append("max_points", String(maxPoints));

      const response = await fetch(`${API_BASE_URL}/api/parse-fel`, {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown parser error" }));
        setStatus(`Parser error: ${error.detail}`);
        return;
      }

      const parsed = (await response.json()) as ParserResponse;
      const source = parsed.saved_session?.cache_hit ? "from saved cache" : "and saved locally";
      applyParsedData(parsed, `Loaded ${file.name} ${source}`);
      await refreshSavedSessions();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the parser service";
      setStatus(`Connection error: ${message}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleLoadSaved(sessionId: string, fileName: string) {
    if (isLoadingSaved || busySessionId) return;
    setStatus(`Opening saved session ${fileName}...`);
    setIsLoadingSaved(true);
    setBusySessionId(sessionId);

    try {
      const response = await fetch(`${API_BASE_URL}/api/saved-sessions/${sessionId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown saved-session error" }));
        setStatus(`Saved session error: ${error.detail}`);
        return;
      }

      const parsed = (await response.json()) as ParserResponse;
      applyParsedData(parsed, `Loaded saved session ${fileName}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the parser service";
      setStatus(`Connection error: ${message}`);
    } finally {
      setIsLoadingSaved(false);
      setBusySessionId(null);
    }
  }

  async function handleRenameSaved(sessionId: string) {
    const nextName = renameValue.trim();
    if (!nextName) {
      setStatus("Rename error: the saved name cannot be empty");
      return;
    }

    setBusySessionId(sessionId);
    setStatus(`Renaming saved session to ${nextName}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/saved-sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ original_filename: nextName }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown rename error" }));
        setStatus(`Rename error: ${error.detail}`);
        return;
      }

      await refreshSavedSessions();
      setRenamingSessionId(null);
      setRenameValue("");
      setData((current) =>
        current?.saved_session?.id === sessionId
          ? {
              ...current,
              saved_session: {
                ...current.saved_session,
                original_filename: nextName,
              },
            }
          : current,
      );
      setStatus(`Renamed saved session to ${nextName}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the parser service";
      setStatus(`Connection error: ${message}`);
    } finally {
      setBusySessionId(null);
    }
  }

  async function handleDeleteSaved(sessionId: string, fileName: string) {
    if (busySessionId) return;
    const confirmed = window.confirm(`Delete saved session "${fileName}"?`);
    if (!confirmed) return;

    setBusySessionId(sessionId);
    setStatus(`Deleting saved session ${fileName}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/saved-sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown delete error" }));
        setStatus(`Delete error: ${error.detail}`);
        return;
      }

      await refreshSavedSessions();
      if (data?.saved_session?.id === sessionId) {
        setData(null);
        setSelected([]);
        setIsSeriesDrawerOpen(false);
      }
      if (renamingSessionId === sessionId) {
        setRenamingSessionId(null);
        setRenameValue("");
      }
      setStatus(`Deleted saved session ${fileName}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the parser service";
      setStatus(`Connection error: ${message}`);
    } finally {
      setBusySessionId(null);
    }
  }

  function toggleSeries(name: string) {
    setSelected((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  function applyPreset(preset: string) {
    if (!data) return;
    setSelected(PRESETS[preset].filter((name) => data.series[name]));
  }

  function togglePhase(phaseKey: (typeof PHASE_KEYS)[number]) {
    setPhaseVisibility((current) => ({
      ...current,
      [phaseKey]: !current[phaseKey],
    }));
  }

  function handleGenerateReport() {
    if (!data) {
      setStatus("Load a parsed session before generating the report");
      return;
    }
    if (!clientName.trim()) {
      setStatus("Enter the client name before generating the report");
      setIsDrawerOpen(true);
      return;
    }
    if (!siteAddress.trim()) {
      setStatus("Enter the project address before generating the report");
      setIsDrawerOpen(true);
      return;
    }

    const html = buildLoadStudyReportHtml(data, {
      clientName,
      address: siteAddress,
    });
    setReportPreviewHtml(html);
    setStatus("Report preview generated");
  }

  async function handleGenerateClientExport() {
    if (!data) {
      setStatus("Load a parsed session before generating the client dashboard");
      return;
    }
    if (!clientName.trim()) {
      setStatus("Enter the client name before generating the client dashboard");
      setIsDrawerOpen(true);
      return;
    }
    if (!siteAddress.trim()) {
      setStatus("Enter the project address before generating the client dashboard");
      setIsDrawerOpen(true);
      return;
    }

    setIsExportingClient(true);
    setStatus("Generating the client dashboard package...");

    try {
      const dashboardHtml = buildClientDashboardHtml(data, {
        clientName,
        address: siteAddress,
      });
      const reportHtml = buildLoadStudyReportHtml(data, {
        clientName,
        address: siteAddress,
      });
      const exportLabel = `${clientName} ${data.saved_session?.original_filename ?? "dashboard"}`.trim();
      const response = await fetch(`${API_BASE_URL}/api/client-exports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dashboard_html: dashboardHtml,
          report_html: reportHtml,
          analysis_payload: data,
          client_name: clientName.trim(),
          site_address: siteAddress.trim(),
          export_label: exportLabel,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Unknown export error" }));
        setStatus(`Client export error: ${error.detail}`);
        return;
      }

      const payload = (await response.json()) as ClientExportResponse;
      setLastClientExport(payload);
      setStatus(
        payload.pdf_generated
          ? `Client package generated in ${payload.export_directory}`
          : `Client package generated in ${payload.export_directory} (PDF pending renderer)`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the parser service";
      setStatus(`Connection error: ${message}`);
    } finally {
      setIsExportingClient(false);
    }
  }

  function handlePrintReport() {
    const frameWindow = reportFrameRef.current?.contentWindow;
    if (!frameWindow) {
      setStatus("Report preview is not ready yet");
      return;
    }
    frameWindow.focus();
    frameWindow.print();
  }

  return (
    <main className="page-shell" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <p style={{ ...eyebrowStyle, marginBottom: 6 }}>Workspace</p>
          <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2.2rem)" }}>Fluke Load Calculation App</h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {data ? (
            <button
              onClick={() => setIsSeriesDrawerOpen((current) => !current)}
              style={secondaryButtonStyle}
              type="button"
            >
              {isSeriesDrawerOpen ? "Close Series" : "Filter Series"}
            </button>
          ) : null}
          <button
            onClick={() => setIsDrawerOpen((current) => !current)}
            style={primaryButtonStyle}
            type="button"
          >
            {isDrawerOpen ? "Close Controls" : "Open Controls"}
          </button>
        </div>
      </div>

      {isDrawerOpen ? (
        <button aria-label="Close drawer" className="drawer-backdrop" onClick={() => setIsDrawerOpen(false)} type="button" />
      ) : null}
      {isSeriesDrawerOpen ? (
        <button
          aria-label="Close series drawer"
          className="drawer-backdrop"
          onClick={() => setIsSeriesDrawerOpen(false)}
          type="button"
        />
      ) : null}
      {reportPreviewHtml ? (
        <div style={modalBackdropStyle}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <p style={{ ...eyebrowStyle, marginBottom: 6 }}>Preview</p>
                <h2 style={{ margin: 0 }}>Electrical Load Study Report</h2>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={handlePrintReport} style={primaryButtonStyle} type="button">
                  Print / Save PDF
                </button>
                <button onClick={() => setReportPreviewHtml(null)} style={secondaryButtonStyle} type="button">
                  Close
                </button>
              </div>
            </div>
            <iframe
              ref={reportFrameRef}
              srcDoc={reportPreviewHtml}
              style={reportFrameStyle}
              title="Report preview"
            />
          </div>
        </div>
      ) : null}

      <div className="app-layout" style={{ display: "grid", gap: 20, minWidth: 0 }}>
        <aside
          className={`control-drawer ${isDrawerOpen ? "open" : ""}`}
          style={{
            ...panelStyle,
            height: "100vh",
            overflowY: "auto",
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            width: "min(460px, 100vw)",
            minWidth: 0,
            borderRadius: 0,
            zIndex: 40,
            paddingTop: 28,
            paddingBottom: 24,
            borderRight: "1px solid rgba(20, 31, 56, 0.08)",
            boxShadow: "16px 0 40px rgba(15, 23, 42, 0.12)",
          }}
        >
          <div style={sidebarHeaderStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "start",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <div>
                <p style={eyebrowStyle}>FastAPI + Next.js</p>
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>Controls</h2>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} style={secondaryButtonStyle} type="button">
                Close
              </button>
            </div>

            <p style={{ ...mutedStyle, marginBottom: 0 }}>
              Sube un <code>.fel</code>, procesa la sesión y reabre estudios guardados sin volver a parsear.
            </p>
          </div>

          <div style={sidebarSectionStyle}>
            <p style={{ ...sectionTitleStyle, marginTop: 0 }}>Saved Sessions</p>
            <div style={savedListStyle}>
            <div style={savedListHeaderStyle}>
              <p style={{ ...sectionTitleStyle, marginBottom: 0 }}>Library</p>
              <button onClick={() => void refreshSavedSessions()} style={secondaryButtonStyle} type="button">
                Refresh
              </button>
            </div>
            <p style={smallMutedStyle}>{savedSessionsStatus}</p>
            {!savedSessions.length ? (
              <p style={smallMutedStyle}>Todavía no hay sesiones guardadas.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {savedSessions.map((session) => (
                  <div
                    key={session.id}
                    style={{ ...savedSessionButtonStyle, opacity: busySessionId === session.id ? 0.7 : 1 }}
                  >
                    {renamingSessionId === session.id ? (
                      <>
                        <input
                          className="control-input"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                        />
                        <div style={savedSessionActionsStyle}>
                          <button
                            onClick={() => void handleRenameSaved(session.id)}
                            style={secondaryButtonStyle}
                            type="button"
                          >
                            Save Name
                          </button>
                          <button
                            onClick={() => {
                              setRenamingSessionId(null);
                              setRenameValue("");
                            }}
                            style={secondaryButtonStyle}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <strong>{session.original_filename}</strong>
                        <span style={smallMutedStyle}>
                          {session.plotted_points.toLocaleString()} plotted · requested step 1/{session.sample_step}
                        </span>
                        <span style={smallMutedStyle}>
                          Study period {formatStudyPeriod(session.study_start_at ?? session.first_record_start, session.study_end_at ?? session.last_record_end)}
                        </span>
                        <span style={smallMutedStyle}>
                          Saved {formatTimestamp(session.cached_at_utc)}
                        </span>
                        <div style={savedSessionActionsStyle}>
                          <button
                            onClick={() => void handleLoadSaved(session.id, session.original_filename)}
                            style={secondaryButtonStyle}
                            type="button"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => {
                              setRenamingSessionId(session.id);
                              setRenameValue(session.original_filename);
                            }}
                            style={secondaryButtonStyle}
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => void handleDeleteSaved(session.id, session.original_filename)}
                            style={dangerButtonStyle}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>

          <div style={sidebarSectionStyle}>
            <p style={{ ...sectionTitleStyle, marginTop: 0 }}>Parser Settings</p>
            <div style={sidebarCardStyle}>
              <label style={fieldStyle}>
                <span>.fel file</span>
                <input
                  className="control-input"
                  type="file"
                  accept=".fel"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>

              <label style={fieldStyle}>
                <span>Chart detail interval</span>
                <input className="control-input" type="number" min={1} value={sampleStep} onChange={(event) => setSampleStep(Number(event.target.value) || 1)} />
                <span style={smallMutedStyle}>Lower values keep more records. Higher values summarize more aggressively.</span>
              </label>

              <label style={fieldStyle}>
                <span>Maximum chart points</span>
                <input className="control-input" type="number" min={100} value={maxPoints} onChange={(event) => setMaxPoints(Number(event.target.value) || 100)} />
                <span style={smallMutedStyle}>The parser spreads these points across the whole study period so the charts and tables represent the full session.</span>
              </label>

              <button
                disabled={!file || isUploading}
                onClick={handleUpload}
                style={{
                  ...primaryButtonStyle,
                  opacity: !file || isUploading ? 0.6 : 1,
                  cursor: !file || isUploading ? "not-allowed" : "pointer",
                }}
                type="button"
              >
                {isUploading ? "Parsing..." : "Parse Session"}
              </button>

              <p style={{ ...mutedStyle, marginTop: 14, marginBottom: 0 }}>{status}</p>
            </div>
          </div>

          {data ? (
            <div style={sidebarSectionStyle}>
              <p style={{ ...sectionTitleStyle, marginTop: 0 }}>Active Session</p>
              <div style={sidebarCardStyle}>
              {data.saved_session ? (
                <div style={{ ...statSummaryCardStyle, marginTop: 0 }}>
                  <div style={{ fontWeight: 700 }}>{data.saved_session.original_filename}</div>
                  <div style={smallMutedStyle}>
                    {data.saved_session.cache_hit ? "Loaded from saved cache" : "Parsed and saved locally"}
                  </div>
                  <div style={smallMutedStyle}>
                    Study period {formatStudyPeriod(data.meta.study_start_at ?? data.meta.first_record_start, data.meta.study_end_at ?? data.meta.last_record_end)}
                  </div>
                  <div style={smallMutedStyle}>
                    Saved {formatTimestamp(data.saved_session.cached_at_utc)}
                  </div>
                </div>
              ) : null}
              <div
                style={sidebarStatsGridStyle}
              >
                <StatCard label="Records" value={data.meta.record_count.toLocaleString()} />
                <StatCard label="Plotted" value={data.meta.plotted_points.toLocaleString()} />
                <StatCard label="Req. Step" value={`1/${data.meta.sample_step}`} />
                <StatCard label="Used Step" value={`1/${data.meta.effective_sample_step ?? data.meta.sample_step}`} />
                <StatCard label="Rec. Size" value={`${data.meta.record_size_bytes} B`} />
              </div>
              </div>
            </div>
          ) : null}

        </aside>

        {data ? (
          <aside
            className={`control-drawer control-drawer-right ${isSeriesDrawerOpen ? "open" : ""}`}
            style={{
              ...panelStyle,
              height: "100vh",
              overflowY: "auto",
              position: "fixed",
              top: 0,
              bottom: 0,
              right: 0,
              width: "min(420px, 100vw)",
              minWidth: 0,
              borderRadius: 0,
              zIndex: 40,
              paddingTop: 28,
              paddingBottom: 24,
              borderLeft: "1px solid rgba(20, 31, 56, 0.08)",
              boxShadow: "-16px 0 40px rgba(15, 23, 42, 0.12)",
            }}
          >
            <div style={sidebarHeaderStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "start",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div>
                  <p style={eyebrowStyle}>Interactive Charts</p>
                  <h2 style={{ marginTop: 0, marginBottom: 8 }}>Series Explorer</h2>
                </div>
                <button onClick={() => setIsSeriesDrawerOpen(false)} style={secondaryButtonStyle} type="button">
                  Close
                </button>
              </div>

              <p style={{ ...mutedStyle, marginBottom: 0 }}>
                Filtra series, aplica presets y elige qué métricas aparecen en las gráficas.
              </p>
            </div>

            <div style={sidebarSectionStyle}>
              <div style={sidebarCardStyle}>
                <div>
                  <p style={sectionTitleStyle}>Presets</p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {Object.keys(PRESETS).map((preset) => (
                      <button key={preset} onClick={() => applyPreset(preset)} style={secondaryButtonStyle} type="button">
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <label style={{ ...fieldStyle, marginTop: 18 }}>
                  <span>Filter series</span>
                  <input className="control-input" value={filter} onChange={(event) => setFilter(event.target.value)} />
                </label>

                <div style={{ maxHeight: "calc(100vh - 260px)", overflow: "auto", display: "grid", gap: 8 }}>
                  {filteredFields.map((field) => (
                    <label key={field.name} style={seriesRowStyle}>
                      <input
                        type="checkbox"
                        checked={selected.includes(field.name)}
                        onChange={() => toggleSeries(field.name)}
                      />
                      <div>
                        <div style={{ fontWeight: 700 }}>{field.name}</div>
                        <div style={smallMutedStyle}>{field.confidence} confidence</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        ) : null}

        <section style={{ display: "grid", gap: 20, minWidth: 0 }}>
          {data ? (
            <div style={panelStyle}>
              <p style={eyebrowStyle}>Deliverables</p>
              <div style={panelHeaderStyle}>
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: 6 }}>Report and Export</h2>
                  <p style={mutedStyle}>
                    Generate the report preview or export the client package from the active loaded session.
                  </p>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 16,
                  alignItems: "end",
                }}
              >
                <label style={{ ...fieldStyle, marginTop: 0 }}>
                  <span>Client name</span>
                  <input
                    className="control-input"
                    placeholder="Enter client name"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                  />
                </label>
                <label style={{ ...fieldStyle, marginTop: 0 }}>
                  <span>Address</span>
                  <input
                    className="control-input"
                    placeholder="Enter project address"
                    value={siteAddress}
                    onChange={(event) => setSiteAddress(event.target.value)}
                  />
                </label>
                <button onClick={handleGenerateReport} style={{ ...primaryButtonStyle, marginTop: 0 }} type="button">
                  Generate PDF Report
                </button>
                <button
                  onClick={() => void handleGenerateClientExport()}
                  style={{ ...primaryButtonStyle, marginTop: 0, opacity: isExportingClient ? 0.75 : 1 }}
                  disabled={isExportingClient}
                  type="button"
                >
                  {isExportingClient ? "Generating Client Package..." : "Generate Client Dashboard"}
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                  marginTop: 14,
                }}
              >
                <p style={smallMutedStyle}>
                  Opens a client-ready report window prepared for Print to PDF.
                </p>
                <p style={smallMutedStyle}>
                  Saves a read-only dashboard, the analyzed JSON, and the report inside a timestamped folder.
                </p>
              </div>
              {lastClientExport ? (
                <div style={{ ...statSummaryCardStyle, marginTop: 14 }}>
                  <div style={{ fontWeight: 700 }}>Last client package</div>
                  <div style={smallMutedStyle}>{lastClientExport.export_directory}</div>
                  <div style={smallMutedStyle}>Dashboard: {lastClientExport.files.dashboard_html}</div>
                  <div style={smallMutedStyle}>
                    PDF: {lastClientExport.pdf_generated ? lastClientExport.files.report_pdf : lastClientExport.pdf_error}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={panelStyle}>
            <p style={eyebrowStyle}>Combined View</p>
            <h2 style={{ marginTop: 0 }}>All Phases Together</h2>
            <div style={timePresetInlineWrapStyle}>
              {TIME_PRESET_OPTIONS.map((option) => (
                <button
                  key={`combined-${option.value}`}
                  onClick={() => {
                    setCombinedTimePreset(option.value);
                    if (option.value !== "study" && !combinedAnchorDate && combinedDateBounds.max) {
                      setCombinedAnchorDate(combinedDateBounds.max);
                    }
                  }}
                  style={{
                    ...secondaryButtonStyle,
                    borderColor:
                      combinedTimePreset === option.value ? "rgba(160,63,50,0.42)" : "rgba(160,63,50,0.18)",
                    background:
                      combinedTimePreset === option.value ? "rgba(246,236,220,0.95)" : "rgba(255,250,241,0.7)",
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
              {combinedTimePreset !== "study" ? (
                <div style={timeInlineControlStyle}>
                  <span style={smallMutedStyle}>
                    {combinedTimePreset === "day" ? "Choose day" : "Choose week"}
                  </span>
                  <input
                    className="control-input"
                    type="date"
                    min={combinedDateBounds.min}
                    max={combinedDateBounds.max}
                    value={combinedAnchorDate || combinedDateBounds.max || ""}
                    onChange={(event) => setCombinedAnchorDate(event.target.value)}
                    style={dateInputStyle}
                  />
                  <span style={smallMutedStyle}>{combinedScoped.label}</span>
                </div>
              ) : null}
            </div>
            <div style={phaseToggleWrapStyle}>
              {PHASE_KEYS.map((phaseKey) => (
                <button
                  key={phaseKey}
                  onClick={() => togglePhase(phaseKey)}
                  style={{
                    ...secondaryButtonStyle,
                    borderColor: phaseVisibility[phaseKey]
                      ? PHASE_META[phaseKey].color
                      : "rgba(160,63,50,0.18)",
                    color: phaseVisibility[phaseKey] ? PHASE_META[phaseKey].color : "#6f5e42",
                    opacity: phaseVisibility[phaseKey] ? 1 : 0.55,
                  }}
                  type="button"
                >
                  {phaseVisibility[phaseKey] ? `Hide ${PHASE_META[phaseKey].label}` : `Show ${PHASE_META[phaseKey].label}`}
                </button>
              ))}
            </div>
            <div className="chart-scroll" style={{ width: "100%", minWidth: 0 }}>
              <InteractiveSeriesChart
                rows={combinedRows}
                series={PHASE_KEYS.filter((phaseKey) => phaseVisibility[phaseKey]).map((phaseKey) => ({
                  name: PHASE_META[phaseKey].label,
                  color: PHASE_META[phaseKey].color,
                  values: combinedRows.map((row) => {
                    const fieldName = `load_calc_${phaseKey}_current_avg`;
                    return typeof row[fieldName] === "number" ? (row[fieldName] as number) : null;
                  }),
                }))}
                yAxisLabel="Current / power"
              />
            </div>
          </div>

          {PHASE_KEYS.map((phaseKey, index) => (
            <ChartPanel
              key={phaseKey}
              title={`Phase ${String.fromCharCode(65 + index)}`}
              rows={visibleRows}
              series={selectedSeries.filter((series) => series.name.includes(phaseKey))}
            />
          ))}
          <ChartPanel
            title="Voltage"
            rows={visibleRows}
            series={selectedSeries.filter((series) => series.name.includes("voltage"))}
          />
          <ChartPanel
            title="Total System Load"
            rows={visibleRows}
            series={selectedSeries.filter(
              (series) => series.name.includes("_total_") || series.name.includes("total_"),
            )}
          />
          <ChartPanel
            title="Frequency"
            rows={visibleRows}
            series={selectedSeries.filter((series) => series.name.includes("frequency"))}
          />
        </section>
      </div>
    </main>
  );
}

function ChartPanel({
  title,
  rows,
  series,
}: {
  title: string;
  rows: ParserRow[];
  series: { name: string; color: string; values: Array<number | null> }[];
}) {
  const [timePreset, setTimePreset] = useState<TimePreset>("study");
  const [anchorDate, setAnchorDate] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const scoped = useMemo(() => applyTimePresetToRows(rows, timePreset, anchorDate), [rows, timePreset, anchorDate]);
  const scopedRows = scoped.rows;
  const dateBounds = useMemo(() => getStudyDateBounds(rows), [rows]);
  const scopedSeries = useMemo(
    () =>
      series.map((item) => ({
        ...item,
        values: item.values.slice(scoped.startIndex, scoped.startIndex + scoped.rows.length),
      })),
    [series, scoped],
  );
  const valid = scopedSeries.flatMap((item) =>
    item.values.filter((value): value is number => typeof value === "number"),
  );
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(scopedRows.length / pageSize));
  const safePage = Math.min(tablePage, pageCount - 1);
  const pagedRows = scopedRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const yAxisLabel = getYAxisLabel(title, scopedSeries);
  const stats = buildSeriesStats(scopedSeries);

  function exportCsv() {
    const csv = buildCsv(scopedRows, scopedSeries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(title)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={panelStyle}>
      <p style={eyebrowStyle}>Chart</p>
      <div style={panelHeaderStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>{title}</h2>
        <button onClick={exportCsv} style={secondaryButtonStyle} type="button">
          Export CSV
        </button>
      </div>
      <div style={timePresetInlineWrapStyle}>
        {TIME_PRESET_OPTIONS.map((option) => (
          <button
            key={`${title}-${option.value}`}
            onClick={() => {
              setTimePreset(option.value);
              setTablePage(0);
              if (option.value !== "study" && !anchorDate && dateBounds.max) {
                setAnchorDate(dateBounds.max);
              }
            }}
            style={{
              ...secondaryButtonStyle,
              borderColor:
                timePreset === option.value ? "rgba(160,63,50,0.42)" : "rgba(160,63,50,0.18)",
              background:
                timePreset === option.value ? "rgba(246,236,220,0.95)" : "rgba(255,250,241,0.7)",
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
        {timePreset !== "study" ? (
          <div style={timeInlineControlStyle}>
            <span style={smallMutedStyle}>{timePreset === "day" ? "Choose day" : "Choose week"}</span>
            <input
              className="control-input"
              type="date"
              min={dateBounds.min}
              max={dateBounds.max}
              value={anchorDate || dateBounds.max || ""}
              onChange={(event) => {
                setAnchorDate(event.target.value);
                setTablePage(0);
              }}
              style={dateInputStyle}
            />
            <span style={smallMutedStyle}>{scoped.label}</span>
          </div>
        ) : null}
      </div>
      {!scopedRows.length || !scopedSeries.length || !valid.length ? (
        <p style={mutedStyle}>Selecciona series compatibles para este panel.</p>
      ) : (
        <>
          <div className="chart-scroll">
            <InteractiveSeriesChart rows={scopedRows} series={scopedSeries} yAxisLabel={yAxisLabel} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
            {scopedSeries.map((item) => (
              <div key={item.name} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: item.color, display: "inline-block" }} />
                <span>{formatSeriesHeaderLabel(item.name)}</span>
              </div>
            ))}
          </div>
          <div style={statsGridStyle}>
            {stats.map((item) => (
              <div key={item.name} style={statSummaryCardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: item.color,
                      display: "inline-block",
                    }}
                  />
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{formatSeriesHeaderLabel(item.name)}</div>
                </div>
                <div style={statsRowStyle}>
                  <span style={smallMutedStyle}>Min</span>
                  <strong>{formatValue(item.min)}</strong>
                </div>
                <div style={statsRowStyle}>
                  <span style={smallMutedStyle}>Max</span>
                  <strong>{formatValue(item.max)}</strong>
                </div>
                <div style={statsRowStyle}>
                  <span style={smallMutedStyle}>Average</span>
                  <strong>{formatValue(item.average)}</strong>
                </div>
                <div style={statsRowStyle}>
                  <span style={smallMutedStyle}>Visible</span>
                  <strong>{formatValue(item.visibleValue)}</strong>
                </div>
              </div>
            ))}
          </div>
          <div style={tableHeaderStyle}>
            <p style={{ ...sectionTitleStyle, marginBottom: 0 }}>Data Table</p>
            <button
              onClick={() => setShowTable((current) => !current)}
              style={secondaryButtonStyle}
              type="button"
            >
              {showTable ? "Hide Data Table" : "Show Data Table"}
            </button>
          </div>
          {showTable ? (
            <>
              <ValueTable rows={pagedRows} series={scopedSeries} />
              <div style={tableControlsStyle}>
                <span style={smallMutedStyle}>
                  Page {safePage + 1} of {pageCount}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setTablePage((current) => Math.max(0, current - 1))}
                    style={secondaryButtonStyle}
                    disabled={safePage === 0}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setTablePage((current) => Math.min(pageCount - 1, current + 1))}
                    style={secondaryButtonStyle}
                    disabled={safePage >= pageCount - 1}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function ValueTable({
  rows,
  series,
}: {
  rows: ParserRow[];
  series: { name: string; color: string; values: Array<number | null> }[];
}) {
  const groupedHeaders = buildSeriesHeaderGroups(series);

  return (
    <div style={tableWrapStyle}>
      <div className="desktop-values-table">
        <table style={tableStyle}>
          <thead>
            {groupedHeaders.length ? (
              <tr>
                <th style={tableHeadStyle} />
                {groupedHeaders.map((group) => (
                  <th key={group.label} colSpan={group.span} style={tableHeadStyle}>
                    {group.label}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              <th style={tableHeadStyle}>Start</th>
              {series.map((item) => (
                <th key={item.name} style={tableHeadStyle}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: item.color,
                      display: "inline-block",
                      marginRight: 8,
                    }}
                  />
                  {formatSeriesHeaderLabel(item.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.record_index}-${rowIndex}`}>
                <td style={tableCellStyle}>{formatTimestamp(row.started_at_utc)}</td>
                {series.map((item) => (
                  <td key={`${row.record_index}-${item.name}`} style={tableCellStyle}>
                    {formatValue(item.values[rowIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-value-cards" style={mobileValueCardsStyle}>
        {rows.map((row, rowIndex) => (
          <div key={`${row.record_index}-card-${rowIndex}`} style={mobileValueCardStyle}>
            <div style={mobileValueCardHeaderStyle}>
              <strong>Reading Time</strong>
              <span style={smallMutedStyle}>{formatTimestamp(row.started_at_utc)}</span>
            </div>
            <div style={mobileValueMetricsStyle}>
              {series.map((item) => (
                <div key={`${row.record_index}-mobile-${item.name}`} style={mobileValueMetricStyle}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: item.color,
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                    />
                    <span style={smallMutedStyle}>{formatSeriesHeaderLabel(item.name)}</span>
                  </div>
                  <strong>{formatValue(item.values[rowIndex])}</strong>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function getYAxisLabel(
  title: string,
  series: { name: string; color: string; values: Array<number | null> }[],
) {
  if (title === "Voltage" || series.some((item) => item.name.includes("voltage"))) return "Voltage (V)";
  if (title.startsWith("Phase") || series.some((item) => item.name.includes("_current_"))) {
    return "Current / power";
  }
  if (title === "Total System Load") return "Total System Load";
  if (title === "Frequency" || series.some((item) => item.name.includes("frequency"))) {
    return "Frequency (Hz)";
  }
  return "Measured value";
}

function buildSeriesStats(series: { name: string; color: string; values: Array<number | null> }[]) {
  return series.flatMap((item) => {
    const numericValues = item.values.filter((value): value is number => value !== null);
    if (!numericValues.length) return [];
    return [
      {
        name: item.name,
        color: item.color,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        average: numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length,
        visibleValue: numericValues[numericValues.length - 1],
      },
    ];
  });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 14, borderRadius: 16, background: "rgba(255,250,241,0.78)", border: "1px solid rgba(81,61,31,0.14)" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6f5e42", marginBottom: 8 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function formatValue(value: number | null) {
  if (value === null) return "-";
  return Number.isInteger(value) ? value.toString() : value.toFixed(3);
}

function formatTimestamp(value: string | number | null) {
  if (typeof value !== "string") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatStudyPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "not available";
  return `${formatTimestamp(start)} to ${formatTimestamp(end)}`;
}

function formatSeriesHeaderLabel(name: string) {
  const voltageHeaderMap: Record<string, string> = {
    load_calc_nominal_ln_voltage_a: "voltage_a",
    load_calc_nominal_ln_voltage_b: "voltage_b",
    load_calc_nominal_ln_voltage_c: "voltage_c",
    load_calc_nominal_ll_voltage_ab: "voltage_ab",
    load_calc_nominal_ll_voltage_bc: "voltage_bc",
    load_calc_nominal_ll_voltage_ca: "voltage_ca",
  };

  return voltageHeaderMap[name] ?? name;
}

function buildSeriesHeaderGroups(series: { name: string }[]) {
  const voltagePrefixMap: Record<string, string> = {
    load_calc_nominal_ln_voltage_a: "load_calc_nominal_ln_",
    load_calc_nominal_ln_voltage_b: "load_calc_nominal_ln_",
    load_calc_nominal_ln_voltage_c: "load_calc_nominal_ln_",
    load_calc_nominal_ll_voltage_ab: "load_calc_nominal_ll_",
    load_calc_nominal_ll_voltage_bc: "load_calc_nominal_ll_",
    load_calc_nominal_ll_voltage_ca: "load_calc_nominal_ll_",
  };

  const groups: Array<{ label: string; span: number }> = [];

  for (const item of series) {
    const label = voltagePrefixMap[item.name] ?? "";
    if (!label) return [];

    const previous = groups[groups.length - 1];
    if (previous?.label === label) {
      previous.span += 1;
    } else {
      groups.push({ label, span: 1 });
    }
  }

  return groups;
}

function applyTimePresetToRows(rows: ParserRow[], preset: TimePreset, anchorDate?: string) {
  if (!rows.length || preset === "study") {
    return { rows, startIndex: 0, label: "Showing full study period" };
  }

  const bounds = getStudyDateBounds(rows);
  const effectiveAnchor = anchorDate || bounds.max;
  if (!effectiveAnchor) {
    return { rows, startIndex: 0, label: "Showing full study period" };
  }

  const range = buildPresetRange(effectiveAnchor, preset);
  const filteredRows = rows.filter((row) => {
    const ts = toTimestamp(row.started_at_utc);
    return ts !== null && ts >= range.start && ts < range.end;
  });
  const startIndex = filteredRows.length ? rows.indexOf(filteredRows[0]) : 0;

  if (!filteredRows.length) {
    return { rows: [], startIndex: 0, label: `No data for ${formatPresetLabel(range.start, range.end, preset)}` };
  }

  return {
    rows: filteredRows,
    startIndex,
    label: formatPresetLabel(range.start, range.end, preset),
  };
}

function toTimestamp(value: string | number | null | undefined) {
  if (typeof value !== "string") return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getStudyDateBounds(rows: ParserRow[]) {
  const timestamps = rows
    .map((row) => toTimestamp(row.started_at_utc))
    .filter((value): value is number => value !== null);
  if (!timestamps.length) {
    return { min: "", max: "" };
  }
  return {
    min: toInputDate(Math.min(...timestamps)),
    max: toInputDate(Math.max(...timestamps)),
  };
}

function buildPresetRange(anchorDate: string, preset: TimePreset) {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  const start = new Date(anchor);

  if (preset === "week") {
    const dayOfWeek = start.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start.setDate(start.getDate() + mondayOffset);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + (preset === "week" ? 7 : 1));

  return { start: start.getTime(), end: end.getTime() };
}

function formatPresetLabel(start: number, end: number, preset: TimePreset) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  if (preset === "day") {
    return `Showing ${formatter.format(new Date(start))}`;
  }
  return `Showing week ${formatter.format(new Date(start))} to ${formatter.format(new Date(end - 1))}`;
}

function toInputDate(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCsv(
  rows: ParserRow[],
  series: { name: string; color: string; values: Array<number | null> }[],
) {
  const headers = ["record_index", "started_at_utc", ...series.map((item) => item.name)];
  const lines = rows.map((row, rowIndex) =>
    [
      row.record_index,
      row.started_at_utc,
      ...series.map((item) => item.values[rowIndex] ?? ""),
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [headers.map(escapeCsvCell).join(","), ...lines].join("\n");
}

function escapeCsvCell(value: string | number) {
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const panelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(247,249,255,0.92) 100%)",
  border: "1px solid rgba(20,31,56,0.08)",
  borderRadius: 24,
  boxShadow: "0 22px 60px rgba(15,23,42,0.08)",
  padding: 24,
  backdropFilter: "blur(10px)",
};

const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 14,
};

const sidebarHeaderStyle: React.CSSProperties = {
  position: "sticky",
  top: -24,
  zIndex: 2,
  margin: "-24px -24px 18px",
  padding: "24px 24px 18px",
  background: "linear-gradient(180deg, rgba(248,250,255,0.98) 0%, rgba(248,250,255,0.92) 82%, rgba(248,250,255,0) 100%)",
  backdropFilter: "blur(10px)",
};

const sidebarSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  marginTop: 18,
};

const sidebarCardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 18,
  background: "rgba(248,250,255,0.84)",
  border: "1px solid rgba(20,31,56,0.08)",
};

const sidebarStatsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 10,
  marginTop: 14,
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 10,
};

const eyebrowStyle: React.CSSProperties = {
  margin: "0 0 10px",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  fontSize: 11,
  color: "#635bff",
  fontWeight: 700,
};

const mutedStyle: React.CSSProperties = {
  color: "#5f6f8f",
  lineHeight: 1.6,
};

const smallMutedStyle: React.CSSProperties = {
  color: "#5f6f8f",
  fontSize: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "#5f6f8f",
  marginBottom: 10,
  fontWeight: 700,
};

const primaryButtonStyle: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid rgba(99,91,255,0.28)",
  background: "linear-gradient(180deg, #6c63ff 0%, #5a54e8 100%)",
  color: "#ffffff",
  borderRadius: 999,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 14px 30px rgba(99,91,255,0.24)",
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(20,31,56,0.1)",
  background: "rgba(255,255,255,0.88)",
  color: "#0a2540",
  borderRadius: 999,
  padding: "10px 12px",
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(15,23,42,0.04)",
};

const seriesRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "20px 1fr",
  gap: 12,
  alignItems: "start",
  padding: 12,
  borderRadius: 14,
  background: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(20,31,56,0.08)",
};

const tableWrapStyle: React.CSSProperties = {
  marginTop: 18,
  overflowX: "hidden",
  overflowY: "auto",
  borderRadius: 18,
  border: "1px solid rgba(20,31,56,0.08)",
  background: "rgba(255,255,255,0.95)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
};

const tableHeadStyle: React.CSSProperties = {
  padding: "12px 14px",
  textAlign: "left",
  fontSize: 12,
  letterSpacing: "0.04em",
  color: "#5f6f8f",
  background: "rgba(244,247,255,0.96)",
  borderBottom: "1px solid rgba(20,31,56,0.08)",
  whiteSpace: "normal",
  wordBreak: "break-word",
  fontWeight: 700,
};

const tableCellStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid rgba(20,31,56,0.06)",
  fontSize: 13,
  color: "#16233b",
  whiteSpace: "normal",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

const tableHeaderStyle: React.CSSProperties = {
  marginTop: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const tableControlsStyle: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const phaseToggleWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 18,
};


const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  marginTop: 16,
};


const statSummaryCardStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 16,
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,255,0.96) 100%)",
  border: "1px solid rgba(20,31,56,0.08)",
};

const statsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 6,
  fontSize: 13,
};

const savedListStyle: React.CSSProperties = {
  marginTop: 18,
  padding: 14,
  borderRadius: 18,
  background: "rgba(248,250,255,0.9)",
  border: "1px solid rgba(20,31,56,0.08)",
};

const savedListHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const savedSessionButtonStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  textAlign: "left",
  border: "1px solid rgba(20,31,56,0.08)",
  background: "rgba(255,255,255,0.96)",
  color: "#16233b",
  borderRadius: 16,
  padding: 12,
  cursor: "pointer",
  boxShadow: "0 8px 22px rgba(15,23,42,0.04)",
};

const savedSessionActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 8,
};

const dangerButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(228,72,72,0.2)",
  background: "rgba(255,241,241,0.95)",
  color: "#c53030",
  borderRadius: 999,
  padding: "10px 12px",
  cursor: "pointer",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.18)",
  backdropFilter: "blur(10px)",
  zIndex: 80,
  display: "grid",
  placeItems: "center",
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "min(1200px, 100%)",
  height: "min(92vh, 100%)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,249,255,0.98) 100%)",
  border: "1px solid rgba(20,31,56,0.08)",
  borderRadius: 24,
  boxShadow: "0 26px 80px rgba(15,23,42,0.12)",
  display: "grid",
  gridTemplateRows: "auto 1fr",
  overflow: "hidden",
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: 18,
  borderBottom: "1px solid rgba(20,31,56,0.08)",
  flexWrap: "wrap",
};

const reportFrameStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  border: 0,
  background: "#fff",
};

const mobileValueCardsStyle: React.CSSProperties = {
  display: "none",
  gap: 12,
  padding: 12,
};

const mobileValueCardStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 16,
  background: "rgba(255,255,255,0.94)",
  border: "1px solid rgba(20,31,56,0.08)",
};

const mobileValueCardHeaderStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  paddingBottom: 10,
  borderBottom: "1px solid rgba(20,31,56,0.08)",
  marginBottom: 10,
};

const mobileValueMetricsStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const mobileValueMetricStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

const timePresetInlineWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

const timeInlineControlStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const dateInputStyle: React.CSSProperties = {
  width: "auto",
  minWidth: 170,
};

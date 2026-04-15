type ParserRow = {
  record_index: number;
  started_at_utc: string;
  ended_at_utc: string;
  [key: string]: string | number | null;
};

type SavedSession = {
  id: string;
  original_filename: string;
  cached_at_utc: string;
  cache_hit: boolean;
};

type StudyProfile = {
  panel?: {
    brand?: string;
    panel_type?: string;
    system?: {
      voltage?: string;
      phases?: number;
      wires?: number;
    };
    capacity?: {
      max_amperage?: number;
      installed_main_breaker?: {
        amperage?: number;
        series?: string;
      };
    };
    identification?: {
      customer_marking?: string;
      location?: string;
    };
  };
  load_study?: {
    device?: string;
    type?: string;
    asset?: string;
    duration?: {
      total?: string;
    };
  };
  observations?: {
    panel_configuration?: string;
    system_type?: string;
  };
};

type ParserResponse = {
  meta: {
    record_count: number;
    plotted_points: number;
    sample_step: number;
    effective_sample_step?: number;
    first_record_start: string | null;
    last_record_end: string | null;
    study_start_at?: string | null;
    study_end_at?: string | null;
  };
  rows: ParserRow[];
  saved_session?: SavedSession;
  study_profile?: StudyProfile | null;
};

type ExportOptions = {
  clientName: string;
  address: string;
};

type InterpretationNotice = {
  title: string;
  body: string;
};

const COMPANY_INFO = {
  name: "ECO TECH ELECTRICAL GROUP",
  license: "LIC# EC13012434",
  phone: "(786) 396-2640",
  website: "eco-techelectricalgroup.com",
  addressLine1: "12005 SW 110 STREET CIR S",
  addressLine2: "MIAMI, FL 33186",
  logoSrc: "./eco_logo.jpg",
};

export function buildClientDashboardHtml(data: ParserResponse, options: ExportOptions) {
  const profile = data.study_profile ?? {};
  const panel = profile.panel ?? {};
  const loadStudy = profile.load_study ?? {};
  const observations = profile.observations ?? {};
  const system = panel.system ?? {};
  const capacity = panel.capacity ?? {};
  const breaker = capacity.installed_main_breaker ?? {};
  const identification = panel.identification ?? {};
  const studyStart = data.meta.study_start_at ?? data.meta.first_record_start;
  const studyEnd = data.meta.study_end_at ?? data.meta.last_record_end;
  const availableFieldNames = new Set(
    data.rows.flatMap((row) => Object.keys(row)).filter((key) => key.startsWith("load_calc_")),
  );
  const studyClassification = classifyStudyDataset(loadStudy.type, availableFieldNames);
  const interpretationNotices = buildInterpretationNotices(studyClassification.scopeLabel, availableFieldNames);
  const payload = {
    clientName: options.clientName.trim(),
    address: options.address.trim(),
    studyPeriod: formatStudyPeriod(studyStart, studyEnd),
    generatedAt: formatTimestamp(new Date().toISOString()),
    company: COMPANY_INFO,
    summaryCards: [
      { label: "Compañía", value: COMPANY_INFO.name },
      { label: "Licencia", value: COMPANY_INFO.license },
      { label: "Cliente", value: options.clientName.trim() || "N/D" },
      { label: "Dirección", value: options.address.trim() || "N/D" },
      { label: "Archivo", value: data.saved_session?.original_filename ?? "Sesión analizada" },
      { label: "Periodo", value: formatStudyPeriod(studyStart, studyEnd) },
      { label: "Alcance", value: studyClassification.scopeLabel },
      { label: "Records", value: data.meta.record_count.toLocaleString("en-US") },
      { label: "Puntos graficados", value: data.meta.plotted_points.toLocaleString("en-US") },
      {
        label: "Panel",
        value: identification.customer_marking || loadStudy.asset || "N/D",
      },
      {
        label: "Sistema",
        value: joinParts([system.voltage, formatSystem(system.phases, system.wires)]) || "N/D",
      },
    ],
    installationRows: [
      { label: "Phone", value: COMPANY_INFO.phone },
      { label: "Website", value: COMPANY_INFO.website },
      { label: "Office", value: `${COMPANY_INFO.addressLine1} | ${COMPANY_INFO.addressLine2}` },
      { label: "Equipo", value: loadStudy.device },
      { label: "Tipo de estudio", value: loadStudy.type },
      { label: "Lectura del dashboard", value: studyClassification.scopeLabel },
      { label: "Activo", value: loadStudy.asset },
      { label: "Duración", value: loadStudy.duration?.total },
      { label: "Marca / panel", value: joinParts([panel.brand, panel.panel_type]) },
      { label: "Configuración", value: observations.panel_configuration },
      { label: "Tipo de sistema", value: observations.system_type },
      { label: "Main breaker", value: joinParts([formatAmperage(breaker.amperage), breaker.series]) },
      { label: "Capacidad panel", value: formatAmperage(capacity.max_amperage) },
      { label: "Ubicación", value: identification.location },
      { label: "Generado", value: formatTimestamp(new Date().toISOString()) },
    ].filter((item) => item.value),
    rows: data.rows,
    meta: data.meta,
    interpretationNotices,
  };

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard Interactivo del Cliente</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4efe7;
      --panel: rgba(255, 250, 241, 0.95);
      --panel-soft: rgba(255, 255, 255, 0.56);
      --line: rgba(81, 61, 31, 0.14);
      --ink: #2b241a;
      --muted: #6f5e42;
      --accent: #a03f32;
      --shadow: 0 24px 60px rgba(66, 51, 30, 0.12);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top, rgba(255,255,255,0.75), transparent 36%),
        linear-gradient(180deg, #f7f2ea 0%, var(--bg) 100%);
    }
    main {
      width: min(1320px, calc(100vw - 24px));
      margin: 0 auto;
      padding: 24px 0 48px;
      display: grid;
      gap: 20px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      padding: 22px;
    }
    .hero {
      display: grid;
      gap: 18px;
    }
    .hero-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .hero-card {
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
      background: linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(248,241,231,0.88) 100%);
      min-height: 220px;
    }
    .brand {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 18px;
      align-items: center;
    }
    .brand img {
      width: 120px;
      max-width: 100%;
      height: auto;
      object-fit: contain;
    }
    .brand-name {
      font-size: 32px;
      line-height: 1.04;
      margin-bottom: 8px;
    }
    .brand-subtitle {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 12px;
    }
    .hero-top {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .hero-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
    }
    .pdf-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 16px;
      border-radius: 999px;
      color: #fffaf1;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      font-weight: 800;
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      box-shadow: 0 14px 32px rgba(180, 95, 42, 0.22);
    }
    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 11px;
      color: var(--accent);
    }
    h1, h2, h3, p { margin: 0; }
    .subtle {
      color: var(--muted);
      line-height: 1.55;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .info-stack {
      display: grid;
      gap: 8px;
    }
    .info-line {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 10px;
      font-size: 13px;
    }
    .info-line strong {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 11px;
    }
    .card, .stat-card {
      padding: 14px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: var(--panel-soft);
    }
    .card-label {
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
    }
    .two-col {
      display: grid;
      gap: 20px;
      grid-template-columns: 0.95fr 1.05fr;
    }
    .details-list {
      display: grid;
      gap: 10px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(81, 61, 31, 0.08);
    }
    .detail-row span:first-child { color: var(--muted); }
    .control-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 18px;
    }
    .control-group {
      display: grid;
      gap: 10px;
    }
    .button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    button {
      border: 1px solid rgba(160,63,50,0.18);
      background: rgba(255,250,241,0.78);
      color: var(--ink);
      border-radius: 999px;
      padding: 10px 12px;
      cursor: pointer;
      font: inherit;
    }
    button.active {
      background: rgba(246,236,220,0.95);
      border-color: rgba(160,63,50,0.42);
    }
    .phase-toggle.active {
      color: white;
      border-color: transparent;
    }
    label {
      display: grid;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }
    input[type="date"], input[type="range"] {
      width: 100%;
    }
    .chart-shell {
      margin-top: 18px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.62);
      padding: 12px;
    }
    .explorer-head {
      display: grid;
      gap: 14px;
    }
    .explorer-meta {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      margin-top: 6px;
    }
    .mini-card {
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
    }
    .mini-card strong {
      display: block;
      font-size: 18px;
      margin-top: 4px;
    }
    .mini-label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .chart-hint {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    svg {
      width: 100%;
      height: auto;
      display: block;
      overflow: visible;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .legend-item.off {
      opacity: 0.45;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
    }
    .stats-grid {
      margin-top: 16px;
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
      font-size: 13px;
    }
    .table-wrap {
      margin-top: 16px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255,255,255,0.66);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(81, 61, 31, 0.08);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    th {
      font-size: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      background: rgba(246,236,220,0.92);
    }
    .table-actions {
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .table-hidden .table-wrap,
    .table-hidden .table-actions {
      display: none;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(255,255,255,0.7);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    .notice-grid {
      display: grid;
      gap: 12px;
    }
    .notice-box {
      padding: 14px;
      border-radius: 18px;
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      background: rgba(255, 247, 235, 0.96);
    }
    @media (max-width: 920px) {
      .hero-header {
        grid-template-columns: 1fr;
      }
      .two-col {
        grid-template-columns: 1fr;
      }
      .hero-actions {
        align-items: flex-start;
      }
      main {
        width: min(100vw - 16px, 1320px);
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel hero">
      <div class="hero-header">
        <div class="hero-card">
          <p class="eyebrow">Prepared By</p>
          <div class="brand">
            <img src="${escapeHtml(COMPANY_INFO.logoSrc)}" alt="${escapeHtml(COMPANY_INFO.name)}" onerror="this.style.display='none'" />
            <div>
              <div class="brand-name">${escapeHtml(COMPANY_INFO.name)}</div>
              <div class="brand-subtitle">Electrical Study & Engineering Support</div>
              <div class="info-stack">
                <div class="info-line"><strong>License</strong><span>${escapeHtml(COMPANY_INFO.license)}</span></div>
                <div class="info-line"><strong>Phone</strong><span>${escapeHtml(COMPANY_INFO.phone)}</span></div>
                <div class="info-line"><strong>Website</strong><span>${escapeHtml(COMPANY_INFO.website)}</span></div>
                <div class="info-line"><strong>Office</strong><span>${escapeHtml(COMPANY_INFO.addressLine1)} | ${escapeHtml(COMPANY_INFO.addressLine2)}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="hero-card">
          <div class="hero-top">
            <div>
              <p class="eyebrow">Client Delivery Dashboard</p>
              <h1>Vista interactiva de solo lectura</h1>
              <p class="subtle">Este archivo mantiene la exploración interactiva del estudio, pero no permite subir archivos FEL ni abrir otras secciones operativas.</p>
            </div>
            <div class="hero-actions">
              <a class="pdf-link" href="./report.pdf" target="_blank" rel="noopener">Ver reporte PDF</a>
              <div class="pill">Generado ${escapeHtml(payload.generatedAt)}</div>
            </div>
          </div>
          <div class="info-stack" style="margin-top:16px;">
            <div class="info-line"><strong>Client</strong><span>${escapeHtml(options.clientName.trim() || "N/D")}</span></div>
            <div class="info-line"><strong>Project</strong><span>${escapeHtml(options.address.trim() || "N/D")}</span></div>
            <div class="info-line"><strong>Study Period</strong><span>${escapeHtml(payload.studyPeriod)}</span></div>
            <div class="info-line"><strong>Scope</strong><span>${escapeHtml(studyClassification.scopeLabel)}</span></div>
            <div class="info-line"><strong>Source File</strong><span>${escapeHtml(data.saved_session?.original_filename ?? "Sesión analizada")}</span></div>
            <div class="info-line"><strong>Asset</strong><span>${escapeHtml(loadStudy.asset || identification.customer_marking || "N/D")}</span></div>
            <div class="info-line"><strong>Panel</strong><span>${escapeHtml(identification.customer_marking || "N/D")}</span></div>
          </div>
        </div>
      </div>
      <div class="cards">
        ${payload.summaryCards
          .map(
            (card) => `<div class="card">
              <div class="card-label">${escapeHtml(card.label)}</div>
              <strong>${escapeHtml(card.value)}</strong>
            </div>`,
          )
          .join("")}
      </div>
    </section>

    <section class="two-col">
      <article class="panel">
        <p class="eyebrow">Resumen</p>
        <h2>Datos de la instalación</h2>
        <div class="details-list">
          ${payload.installationRows
            .map(
              (row) => `<div class="detail-row">
                <span>${escapeHtml(row.label)}</span>
                <strong>${escapeHtml(row.value ?? "")}</strong>
              </div>`,
            )
            .join("")}
        </div>
      </article>
      <article class="panel">
        <p class="eyebrow">Interpretación</p>
        <h2>Alcance y cautelas</h2>
        <div class="notice-grid">
          ${payload.interpretationNotices
            .map(
              (notice) => `<div class="notice-box">
                <strong>${escapeHtml(notice.title)}</strong>
                <p class="subtle" style="margin-top:8px;">${escapeHtml(notice.body)}</p>
              </div>`,
            )
            .join("")}
        </div>
      </article>
    </section>

    <section class="panel">
      <p class="eyebrow">Modo cliente</p>
      <h2>Interacción disponible</h2>
      <div class="details-list">
        <div class="detail-row"><span>Paneles</span><strong>Combined, Voltage, Totals, Frequency</strong></div>
        <div class="detail-row"><span>Gráficas por fase</span><strong>Phase A, Phase B y Phase C</strong></div>
        <div class="detail-row"><span>Filtro de tiempo</span><strong>Study, Week, Day</strong></div>
        <div class="detail-row"><span>Ventana visible</span><strong>Inicio / fin ajustables</strong></div>
        <div class="detail-row"><span>Zoom / paneo</span><strong>Rueda del mouse y arrastre</strong></div>
        <div class="detail-row"><span>Leyendas</span><strong>Ocultar y mostrar series</strong></div>
        <div class="detail-row"><span>Tabla</span><strong>Paginada y sincronizada</strong></div>
      </div>
    </section>

    <section class="panel" id="interactive-root">
      <p class="eyebrow">Exploración</p>
      <div class="explorer-head">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div class="pill" style="margin-bottom:10px;">Gráficas de la app original</div>
            <h2 id="panel-title">Combined View</h2>
            <p class="subtle" id="panel-subtitle">Explora la sesión con controles de solo lectura.</p>
          </div>
          <div class="pill" id="window-label">${escapeHtml(payload.studyPeriod)}</div>
        </div>
        <div class="explorer-meta" id="explorer-meta">
          <div class="mini-card">
            <div class="mini-label">Panel activo</div>
            <strong id="meta-panel">Combined View</strong>
          </div>
          <div class="mini-card">
            <div class="mini-label">Series visibles</div>
            <strong id="meta-series">3</strong>
          </div>
          <div class="mini-card">
            <div class="mini-label">Filas visibles</div>
            <strong id="meta-rows">0</strong>
          </div>
          <div class="mini-card">
            <div class="mini-label">Preset actual</div>
            <strong id="meta-preset">Study</strong>
          </div>
        </div>
      </div>

      <div class="control-grid">
        <div class="control-group">
          <strong>Panel</strong>
          <div class="button-row" id="panel-buttons"></div>
        </div>
        <div class="control-group">
          <strong>Preset</strong>
          <div class="button-row" id="preset-buttons"></div>
          <label id="date-wrap">
            Fecha de anclaje
            <input id="anchor-date" type="date" />
          </label>
        </div>
        <div class="control-group">
          <strong>Ventana visible</strong>
          <label>
            Inicio
            <input id="window-start" type="range" min="0" max="95" value="0" />
          </label>
          <label>
            Fin
            <input id="window-end" type="range" min="5" max="100" value="100" />
          </label>
        </div>
        <div class="control-group">
          <strong>Tabla</strong>
          <div class="button-row">
            <button id="table-toggle" type="button">Ocultar tabla</button>
          </div>
          <div class="button-row" id="phase-toggles"></div>
        </div>
      </div>

      <div class="chart-shell">
        <div id="chart-host"></div>
        <div class="legend" id="legend"></div>
        <div class="chart-hint">Usa la rueda del mouse para zoom y arrastra sobre la gráfica para paneo horizontal.</div>
      </div>

      <div class="stats-grid" id="stats-grid"></div>

      <div id="table-section">
        <div class="table-wrap">
          <table>
            <thead id="table-head"></thead>
            <tbody id="table-body"></tbody>
          </table>
        </div>
        <div class="table-actions">
          <span class="subtle" id="page-label"></span>
          <div class="button-row">
            <button id="prev-page" type="button">Previous</button>
            <button id="next-page" type="button">Next</button>
          </div>
        </div>
      </div>
    </section>
  </main>

  <script>
    const PAYLOAD = ${safeJson(payload)};
    const PANELS = {
      combined: {
        title: "Combined View",
        subtitle: "Las tres fases juntas para revisar el comportamiento general.",
        series: [
          { key: "load_calc_phase_a_current_avg", label: "Phase A", color: "#b5402a", phase: "phase_a" },
          { key: "load_calc_phase_b_current_avg", label: "Phase B", color: "#2f6fdf", phase: "phase_b" },
          { key: "load_calc_phase_c_current_avg", label: "Phase C", color: "#2f8a57", phase: "phase_c" },
        ],
      },
      phase_a: {
        title: "Phase A",
        subtitle: "Corriente, potencia y referencia para la fase A.",
        series: [
          { key: "load_calc_phase_a_current_avg", label: "Current Avg", color: "#b5402a" },
          { key: "load_calc_phase_a_kw_avg", label: "kW Avg", color: "#cf9334" },
          { key: "load_calc_phase_a_current_reference", label: "Current Ref", color: "#6f58a8" },
        ],
      },
      phase_b: {
        title: "Phase B",
        subtitle: "Corriente, potencia y referencia para la fase B.",
        series: [
          { key: "load_calc_phase_b_current_avg", label: "Current Avg", color: "#2f6fdf" },
          { key: "load_calc_phase_b_kw_avg", label: "kW Avg", color: "#7aa4ec" },
          { key: "load_calc_phase_b_current_reference", label: "Current Ref", color: "#6f58a8" },
        ],
      },
      phase_c: {
        title: "Phase C",
        subtitle: "Corriente, potencia y referencia para la fase C.",
        series: [
          { key: "load_calc_phase_c_current_avg", label: "Current Avg", color: "#2f8a57" },
          { key: "load_calc_phase_c_kw_avg", label: "kW Avg", color: "#68b37a" },
          { key: "load_calc_phase_c_current_reference", label: "Current Ref", color: "#6f58a8" },
        ],
      },
      voltage: {
        title: "Voltage",
        subtitle: "Voltajes nominales línea-neutro del periodo visible.",
        series: [
          { key: "load_calc_nominal_ln_voltage_a", label: "Voltage A-N", color: "#884e24" },
          { key: "load_calc_nominal_ln_voltage_b", label: "Voltage B-N", color: "#365fa8" },
          { key: "load_calc_nominal_ln_voltage_c", label: "Voltage C-N", color: "#3e7b56" },
          { key: "load_calc_nominal_ll_voltage_ab", label: "Voltage A-B", color: "#cf9334" },
          { key: "load_calc_nominal_ll_voltage_bc", label: "Voltage B-C", color: "#6f58a8" },
          { key: "load_calc_nominal_ll_voltage_ca", label: "Voltage C-A", color: "#2f7d7d" },
        ],
      },
      totals: {
        title: "Totals",
        subtitle: "Demanda total y referencias de la sesión cargada.",
        series: [
          { key: "load_calc_total_kw_avg", label: "Total kW Avg", color: "#6f58a8" },
          { key: "load_calc_total_kw_max", label: "Total kW Max", color: "#cf9334" },
          { key: "load_calc_total_current_reference_1", label: "Total Current Ref", color: "#2f7d7d" },
        ],
      },
      frequency: {
        title: "Frequency",
        subtitle: "Frecuencia mínima, promedio y máxima visible.",
        series: [
          { key: "load_calc_frequency_min", label: "Frequency Min", color: "#8c6a2d" },
          { key: "load_calc_frequency_avg", label: "Frequency Avg", color: "#a03f32" },
          { key: "load_calc_frequency_max", label: "Frequency Max", color: "#3f7c74" },
        ],
      },
    };

    const state = {
      panel: "combined",
      preset: "study",
      anchorDate: "",
      windowStart: 0,
      windowEnd: 100,
      dragStartX: null,
      dragWindow: null,
      globalDragListenersBound: false,
      page: 0,
      showTable: true,
      hiddenSeries: {},
      phaseVisibility: { phase_a: true, phase_b: true, phase_c: true },
    };

    const els = {
      panelButtons: document.getElementById("panel-buttons"),
      presetButtons: document.getElementById("preset-buttons"),
      panelTitle: document.getElementById("panel-title"),
      panelSubtitle: document.getElementById("panel-subtitle"),
      chartHost: document.getElementById("chart-host"),
      legend: document.getElementById("legend"),
      statsGrid: document.getElementById("stats-grid"),
      tableHead: document.getElementById("table-head"),
      tableBody: document.getElementById("table-body"),
      pageLabel: document.getElementById("page-label"),
      prevPage: document.getElementById("prev-page"),
      nextPage: document.getElementById("next-page"),
      dateWrap: document.getElementById("date-wrap"),
      anchorDate: document.getElementById("anchor-date"),
      windowStart: document.getElementById("window-start"),
      windowEnd: document.getElementById("window-end"),
      tableToggle: document.getElementById("table-toggle"),
      tableSection: document.getElementById("table-section"),
      phaseToggles: document.getElementById("phase-toggles"),
      windowLabel: document.getElementById("window-label"),
      metaPanel: document.getElementById("meta-panel"),
      metaSeries: document.getElementById("meta-series"),
      metaRows: document.getElementById("meta-rows"),
      metaPreset: document.getElementById("meta-preset"),
    };

    const PRESETS = [
      { value: "study", label: "Study" },
      { value: "week", label: "Week" },
      { value: "day", label: "Day" },
    ];

    init();

    function init() {
      buildPanelButtons();
      buildPresetButtons();
      buildPhaseButtons();
      const bounds = getDateBounds(PAYLOAD.rows);
      els.anchorDate.min = bounds.min || "";
      els.anchorDate.max = bounds.max || "";
      els.anchorDate.value = bounds.max || "";
      state.anchorDate = bounds.max || "";

      els.anchorDate.addEventListener("change", (event) => {
        state.anchorDate = event.target.value;
        state.page = 0;
        render();
      });
      els.windowStart.addEventListener("input", (event) => {
        const next = Number(event.target.value);
        state.windowStart = Math.min(next, state.windowEnd - 5);
        els.windowStart.value = String(state.windowStart);
        state.page = 0;
        render();
      });
      els.windowEnd.addEventListener("input", (event) => {
        const next = Number(event.target.value);
        state.windowEnd = Math.max(next, state.windowStart + 5);
        els.windowEnd.value = String(state.windowEnd);
        state.page = 0;
        render();
      });
      els.tableToggle.addEventListener("click", () => {
        state.showTable = !state.showTable;
        render();
      });
      els.prevPage.addEventListener("click", () => {
        state.page = Math.max(0, state.page - 1);
        renderTable();
      });
      els.nextPage.addEventListener("click", () => {
        state.page += 1;
        renderTable();
      });

      render();
    }

    function buildPanelButtons() {
      els.panelButtons.innerHTML = Object.entries(PANELS)
        .map(([key, panel]) => '<button type="button" data-panel="' + key + '">' + escapeHtml(panel.title) + "</button>")
        .join("");
      els.panelButtons.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          state.panel = button.dataset.panel;
          state.page = 0;
          render();
        });
      });
    }

    function buildPresetButtons() {
      els.presetButtons.innerHTML = PRESETS
        .map((preset) => '<button type="button" data-preset="' + preset.value + '">' + preset.label + "</button>")
        .join("");
      els.presetButtons.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          state.preset = button.dataset.preset;
          state.page = 0;
          render();
        });
      });
    }

    function buildPhaseButtons() {
      const phases = [
        { key: "phase_a", label: "Phase A", color: "#b5402a" },
        { key: "phase_b", label: "Phase B", color: "#2f6fdf" },
        { key: "phase_c", label: "Phase C", color: "#2f8a57" },
      ];
      els.phaseToggles.innerHTML = phases
        .map(
          (phase) =>
            '<button type="button" class="phase-toggle" data-phase="' +
            phase.key +
            '" data-color="' +
            phase.color +
            '">' +
            phase.label +
            "</button>",
        )
        .join("");
      els.phaseToggles.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.phase;
          state.phaseVisibility[key] = !state.phaseVisibility[key];
          render();
        });
      });
    }

    function render() {
      syncButtons();
      renderChart();
      renderTable();
    }

    function syncButtons() {
      els.panelButtons.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("active", button.dataset.panel === state.panel);
      });
      els.presetButtons.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("active", button.dataset.preset === state.preset);
      });
      els.phaseToggles.querySelectorAll("button").forEach((button) => {
        const key = button.dataset.phase;
        const active = !!state.phaseVisibility[key];
        button.classList.toggle("active", active);
        button.style.background = active ? button.dataset.color : "rgba(255,250,241,0.78)";
      });
      els.dateWrap.style.display = state.preset === "study" ? "none" : "grid";
      els.phaseToggles.style.display = state.panel === "combined" ? "flex" : "none";
      els.tableSection.classList.toggle("table-hidden", !state.showTable);
      els.tableToggle.textContent = state.showTable ? "Ocultar tabla" : "Mostrar tabla";
      els.panelTitle.textContent = PANELS[state.panel].title;
      els.panelSubtitle.textContent = PANELS[state.panel].subtitle;
      els.metaPanel.textContent = PANELS[state.panel].title;
      els.metaPreset.textContent = PRESETS.find((preset) => preset.value === state.preset)?.label ?? state.preset;
    }

    function getActiveSeries() {
      return PANELS[state.panel].series.filter((series) => {
        if (series.phase && !state.phaseVisibility[series.phase]) return false;
        if (state.hiddenSeries[series.key]) return false;
        return true;
      });
    }

    function getScopedRows() {
      const presetRows = applyPreset(PAYLOAD.rows, state.preset, state.anchorDate);
      const total = presetRows.length;
      if (!total) {
        return { rows: [], label: "Sin datos para el rango seleccionado" };
      }

      const startIndex = Math.floor((state.windowStart / 100) * Math.max(total - 1, 0));
      const endIndex = Math.max(startIndex + 1, Math.ceil((state.windowEnd / 100) * total));
      const rows = presetRows.slice(startIndex, endIndex);
      const startLabel = rows[0] ? formatTimestamp(rows[0].started_at_utc) : "-";
      const endLabel = rows[rows.length - 1] ? formatTimestamp(rows[rows.length - 1].started_at_utc) : "-";
      return { rows, label: startLabel + " a " + endLabel };
    }

    function renderChart() {
      const scoped = getScopedRows();
      const activeSeries = getActiveSeries();
      const series = activeSeries.map((item) => ({
        ...item,
        values: scoped.rows.map((row) => asNumber(row[item.key])),
      })).filter((item) => item.values.some((value) => value !== null));

      els.windowLabel.textContent = scoped.label;
      els.metaSeries.textContent = String(series.length);
      els.metaRows.textContent = scoped.rows.length.toLocaleString("en-US");

      if (!scoped.rows.length || !series.length) {
        els.chartHost.innerHTML = '<div class="subtle">No hay datos visibles para este panel.</div>';
        els.legend.innerHTML = "";
        els.statsGrid.innerHTML = "";
        return;
      }

      els.chartHost.innerHTML = buildChartSvg(series);
      bindChartInteractions();
      els.legend.innerHTML = PANELS[state.panel].series
        .filter((item) => !item.phase || state.phaseVisibility[item.phase])
        .map((item) => {
          const off = state.hiddenSeries[item.key] ? " off" : "";
          return '<span class="legend-item' + off + '" data-series="' + item.key + '">' +
            '<span class="dot" style="background:' + item.color + '"></span>' +
            escapeHtml(item.label) +
            "</span>";
        })
        .join("");

      els.legend.querySelectorAll(".legend-item").forEach((item) => {
        item.addEventListener("click", () => {
          const key = item.dataset.series;
          state.hiddenSeries[key] = !state.hiddenSeries[key];
          state.page = 0;
          render();
        });
      });

      els.statsGrid.innerHTML = series.map((item) => {
        const numbers = item.values.filter((value) => typeof value === "number");
        const avg = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
        return '<div class="stat-card">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
          '<span class="dot" style="background:' + item.color + '"></span>' +
          '<strong>' + escapeHtml(item.label) + "</strong></div>" +
          statRow("Min", formatNumber(Math.min(...numbers))) +
          statRow("Max", formatNumber(Math.max(...numbers))) +
          statRow("Prom", formatNumber(avg)) +
          statRow("Visible", formatNumber(numbers[numbers.length - 1])) +
          "</div>";
      }).join("");
    }

    function renderTable() {
      const scoped = getScopedRows();
      const activeSeries = getActiveSeries();
      const rows = scoped.rows;
      const pageSize = 10;
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
      state.page = Math.min(state.page, pageCount - 1);
      const pagedRows = rows.slice(state.page * pageSize, state.page * pageSize + pageSize);

      els.tableHead.innerHTML = '<tr><th>Index</th><th>Inicio</th>' +
        activeSeries.map((item) => "<th>" + escapeHtml(item.label) + "</th>").join("") +
        "</tr>";

      els.tableBody.innerHTML = pagedRows.map((row) => {
        return "<tr><td>" + row.record_index + "</td><td>" + escapeHtml(formatTimestamp(row.started_at_utc)) + "</td>" +
          activeSeries.map((item) => "<td>" + formatValue(asNumber(row[item.key])) + "</td>").join("") +
          "</tr>";
      }).join("");

      els.pageLabel.textContent = rows.length
        ? "Page " + (state.page + 1) + " of " + pageCount + " · " + rows.length + " filas visibles"
        : "Sin filas visibles";
      els.prevPage.disabled = state.page === 0;
      els.nextPage.disabled = state.page >= pageCount - 1;
    }

    function buildChartSvg(series) {
      const width = 1120;
      const height = 380;
      const padding = { top: 18, right: 22, bottom: 36, left: 56 };
      const values = series.flatMap((item) => item.values.filter((value) => typeof value === "number"));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const innerWidth = width - padding.left - padding.right;
      const innerHeight = height - padding.top - padding.bottom;

      const grid = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const y = padding.top + innerHeight * ratio;
        const value = max - span * ratio;
        return '<line x1="' + padding.left + '" y1="' + y + '" x2="' + (width - padding.right) + '" y2="' + y + '" stroke="rgba(81,61,31,0.12)" stroke-width="1" />' +
          '<text x="' + (padding.left - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="#6f5e42" font-size="11">' + escapeHtml(formatNumber(value)) + "</text>";
      }).join("");

      const paths = series.map((item) => {
        const points = item.values.map((value, index) => {
          if (value === null) return null;
          const ratioX = item.values.length <= 1 ? 0 : index / (item.values.length - 1);
          const x = padding.left + innerWidth * ratioX;
          const y = padding.top + ((max - value) / span) * innerHeight;
          return x + "," + y;
        }).filter(Boolean).join(" ");
        if (!points) return "";
        return '<polyline fill="none" stroke="' + item.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + points + '" />';
      }).join("");

      return '<svg id="interactive-svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="interactive chart">' +
        grid +
        '<line x1="' + padding.left + '" y1="' + (height - padding.bottom) + '" x2="' + (width - padding.right) + '" y2="' + (height - padding.bottom) + '" stroke="rgba(81,61,31,0.18)" stroke-width="1.2" />' +
        paths +
        "</svg>";
    }

    function bindChartInteractions() {
      const svg = document.getElementById("interactive-svg");
      if (!svg) return;

      svg.addEventListener("wheel", handleChartWheel, { passive: false });
      svg.addEventListener("mousedown", startChartDrag);
      if (!state.globalDragListenersBound) {
        window.addEventListener("mousemove", handleChartDrag);
        window.addEventListener("mouseup", stopChartDrag);
        state.globalDragListenersBound = true;
      }
    }

    function handleChartWheel(event) {
      event.preventDefault();
      const currentSpan = state.windowEnd - state.windowStart;
      const nextSpan = Math.max(8, Math.min(100, currentSpan + (event.deltaY > 0 ? 8 : -8)));
      const svg = document.getElementById("interactive-svg");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const center = state.windowStart + currentSpan * clampedRatio;
      let nextStart = center - nextSpan * clampedRatio;
      nextStart = Math.max(0, Math.min(100 - nextSpan, nextStart));
      state.windowStart = nextStart;
      state.windowEnd = nextStart + nextSpan;
      els.windowStart.value = String(Math.round(state.windowStart));
      els.windowEnd.value = String(Math.round(state.windowEnd));
      state.page = 0;
      render();
    }

    function startChartDrag(event) {
      state.dragStartX = event.clientX;
      state.dragWindow = { start: state.windowStart, end: state.windowEnd };
    }

    function handleChartDrag(event) {
      if (state.dragStartX === null || !state.dragWindow) return;
      const svg = document.getElementById("interactive-svg");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const delta = ((event.clientX - state.dragStartX) / rect.width) * 100;
      const span = state.dragWindow.end - state.dragWindow.start;
      let nextStart = state.dragWindow.start - delta;
      nextStart = Math.max(0, Math.min(100 - span, nextStart));
      state.windowStart = nextStart;
      state.windowEnd = nextStart + span;
      els.windowStart.value = String(Math.round(state.windowStart));
      els.windowEnd.value = String(Math.round(state.windowEnd));
      state.page = 0;
      render();
    }

    function stopChartDrag() {
      state.dragStartX = null;
      state.dragWindow = null;
    }

    function applyPreset(rows, preset, anchorDate) {
      if (preset === "study") return rows;
      if (!anchorDate) return rows;
      const range = buildRange(anchorDate, preset);
      return rows.filter((row) => {
        const ts = toTimestamp(row.started_at_utc);
        return ts !== null && ts >= range.start && ts < range.end;
      });
    }

    function buildRange(anchorDate, preset) {
      const start = new Date(anchorDate + "T00:00:00");
      if (preset === "week") {
        const weekday = start.getDay();
        const offset = weekday === 0 ? -6 : 1 - weekday;
        start.setDate(start.getDate() + offset);
      }
      const end = new Date(start);
      end.setDate(end.getDate() + (preset === "week" ? 7 : 1));
      return { start: start.getTime(), end: end.getTime() };
    }

    function getDateBounds(rows) {
      const stamps = rows.map((row) => toTimestamp(row.started_at_utc)).filter((value) => value !== null);
      if (!stamps.length) return { min: "", max: "" };
      return { min: toInputDate(Math.min(...stamps)), max: toInputDate(Math.max(...stamps)) };
    }

    function toInputDate(timestamp) {
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return year + "-" + month + "-" + day;
    }

    function toTimestamp(value) {
      if (typeof value !== "string") return null;
      const timestamp = new Date(value).getTime();
      return Number.isNaN(timestamp) ? null : timestamp;
    }

    function asNumber(value) {
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    function formatValue(value) {
      return value === null ? "-" : formatNumber(value);
    }

    function formatNumber(value) {
      return Number.isFinite(value) ? value.toFixed(3) : "-";
    }

    function formatTimestamp(value) {
      if (!value) return "-";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-US");
    }

    function statRow(label, value) {
      return '<div class="stat-row"><span style="color:#6f5e42;">' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  </script>
</body>
</html>`;
}

function classifyStudyDataset(declaredStudyType: string | undefined, availableFieldNames: Set<string>) {
  const normalized = (declaredStudyType || "").toLowerCase();
  const hasOnlyLoadCalcFields =
    availableFieldNames.size > 0 &&
    [...availableFieldNames].every((fieldName) => fieldName.startsWith("load_calc_"));

  if (normalized.includes("load")) {
    return { scopeLabel: "Load Study interpretation" };
  }

  if (hasOnlyLoadCalcFields) {
    return { scopeLabel: "Load Study interpretation" };
  }

  return { scopeLabel: "Mixed electrical interpretation" };
}

function buildInterpretationNotices(scopeLabel: string, availableFieldNames: Set<string>): InterpretationNotice[] {
  const notices: InterpretationNotice[] = [
    {
      title: "Scope",
      body:
        `Este dashboard se presenta como ${scopeLabel.toLowerCase()} según la documentación Fluke 174x. Está orientado a carga, demanda, balance entre fases y capacidad, no a conclusiones normativas completas de power quality.`,
    },
    {
      title: "Estimated kVA",
      body:
        "Los valores aparentes derivados en esta vista pueden calcularse a partir de corriente medida y tensión nominal disponible. Son útiles para planeación y comparación, pero no deben describirse como valores PQ medidos directamente por el instrumento cuando el canal no existe en la fuente.",
    },
  ];

  const hasPowerQualityFamilies =
    [...availableFieldNames].some((fieldName) => /thd|tdd|flicker|event|harmonic|interharmonic|unbalance/.test(fieldName));

  if (!hasPowerQualityFamilies) {
    notices.push({
      title: "Power Quality Disclaimer",
      body:
        "Este export no expone canales parseados de THD, TDD, flicker, armónicos, interarmónicos ni eventos. Por tanto, no debe usarse por sí solo para afirmar cumplimiento o incumplimiento de calidad de energía.",
    });
  }

  return notices;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function formatStudyPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "No disponible";
  return `${formatTimestamp(start)} a ${formatTimestamp(end)}`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "N/D";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US");
}

function formatSystem(phases?: number, wires?: number) {
  if (!phases || !wires) return "";
  return `${phases}P / ${wires}W`;
}

function formatAmperage(value?: number) {
  return typeof value === "number" ? `${value} A` : "";
}

function joinParts(values: Array<string | undefined>) {
  return values.filter(Boolean).join(" · ");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ParserRow = {
  record_index: number;
  started_at_utc: string;
  ended_at_utc: string;
  [key: string]: string | number | null;
};

type ParserResponse = {
  meta: {
    first_record_start: string | null;
    last_record_end: string | null;
    study_start_at?: string | null;
    study_end_at?: string | null;
  };
  rows: ParserRow[];
  series: Record<string, Array<number | null>>;
  study_profile?: StudyProfile | null;
};

type ReportOptions = {
  clientName: string;
  address: string;
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
      main_lug?: boolean;
      installed_main_breaker?: {
        amperage?: number;
        series?: string;
      };
    };
    identification?: {
      catalog_number?: string;
      serial_number?: string;
      customer_marking?: string;
      item_number?: string;
      location?: string;
      date?: string;
    };
    technical_specifications?: {
      short_circuit_rating?: {
        max?: string;
        min_configuration?: string;
      };
      conductors?: {
        temperature_ratings?: string[];
        materials?: string[];
      };
    };
    compliance?: {
      nec_articles?: string[];
      max_circuits_if_lighting_exceeds_10_percent?: number;
      usage?: string[];
    };
  };
  load_study?: {
    device?: string;
    type?: string;
    duration?: {
      total?: string;
      start?: string;
      end?: string;
    };
    asset?: string;
    file_size_kb?: number;
  };
  observations?: {
    panel_configuration?: string;
    main_breaker_note?: string;
    system_type?: string;
    wiring?: {
      type?: string;
      conduit?: string;
      phases_colors?: string[];
      neutral_color?: string;
    };
  };
};

type PhaseSummary = {
  label: string;
  averageKva: number;
  peakKva: number;
  minimumKva: number;
};

type WeeklySummary = {
  label: string;
  average: number;
  peak: number;
  minimum: number;
};

type AiAnalysisSection = {
  title: string;
  body: string;
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

export function openLoadStudyReport(data: ParserResponse, options: ReportOptions) {
  return buildLoadStudyReportHtml(data, options);
}

export function buildLoadStudyReportHtml(data: ParserResponse, options: ReportOptions) {
  const summary = buildReportSummary(data, options);
  return buildReportHtml(summary);
}

function buildReportSummary(data: ParserResponse, options: ReportOptions) {
  const rows = data.rows;
  const profile = data.study_profile ?? {};
  const panel = profile.panel ?? {};
  const system = panel.system ?? {};
  const capacity = panel.capacity ?? {};
  const breaker = capacity.installed_main_breaker ?? {};
  const identification = panel.identification ?? {};
  const technical = panel.technical_specifications ?? {};
  const conductors = technical.conductors ?? {};
  const shortCircuit = technical.short_circuit_rating ?? {};
  const compliance = panel.compliance ?? {};
  const loadStudy = profile.load_study ?? {};
  const duration = loadStudy.duration ?? {};
  const observations = profile.observations ?? {};
  const wiring = observations.wiring ?? {};
  const phaseSummaries = buildPhaseSummaries(rows);
  const weeklySummaries = buildWeeklySummaries(rows);
  const availableFieldNames = new Set(
    rows.flatMap((row) => Object.keys(row)).filter((key) => key.startsWith("load_calc_")),
  );
  const totalAverageSeries = rows.map((row) => totalEstimatedKva(row));
  const totalKwAverageSeries = rows.map((row) => asNumber(row.load_calc_total_kw_avg)).filter(isFiniteNumber);
  const totalKwMaxSeries = rows.map((row) => asNumber(row.load_calc_total_kw_max)).filter(isFiniteNumber);
  const studyClassification = classifyStudyDataset({
    declaredStudyType: loadStudy.type,
    availableFieldNames,
  });
  const interpretationNotices = buildInterpretationNotices({
    studyClassification,
    availableFieldNames,
  });

  const mad = safeMax(totalKwAverageSeries);
  const mcl = mad * 1.25;
  const baseLoad = safeMin(totalKwAverageSeries);
  const totalConnectedLoad = safeMax(totalKwMaxSeries);
  const projectedLoad = Math.max(mcl, totalConnectedLoad) * 1.15;
  const overallAverageLoad = safeAverage(totalAverageSeries);
  const peakDemand = safeMax(totalAverageSeries);
  const averagePhaseKva = safeAverage(phaseSummaries.map((phase) => phase.averageKva));
  const phaseImbalance = averagePhaseKva
    ? (safeMax(phaseSummaries.map((phase) => Math.abs(phase.averageKva - averagePhaseKva))) /
        averagePhaseKva) *
      100
    : 0;
  const panelName = identification.customer_marking || loadStudy.asset || "Not identified";
  const loadStudyStart = data.meta.study_start_at ?? data.meta.first_record_start ?? duration.start ?? null;
  const loadStudyEnd = data.meta.study_end_at ?? data.meta.last_record_end ?? duration.end ?? null;
  const panelDetails = [
    detailRow("Panel", panelName),
    detailRow("Brand / Type", joinParts([panel.brand, panel.panel_type])),
    detailRow("System", joinParts([system.voltage, formatSystem(system.phases, system.wires)])),
    detailRow("Panel Rating", formatAmperage(capacity.max_amperage)),
    detailRow("Installed Main Breaker", joinParts([formatAmperage(breaker.amperage), breaker.series])),
    detailRow("Catalog Number", identification.catalog_number),
    detailRow("Serial Number", identification.serial_number),
    detailRow("Location", identification.location),
    detailRow("Panel Date", formatDateOnly(identification.date)),
    detailRow("Short Circuit Rating", shortCircuit.max),
    detailRow("Minimum SCCR Configuration", shortCircuit.min_configuration),
  ].filter(isDetailRow);
  const loadStudyDetails = [
    detailRow("Device", loadStudy.device),
    detailRow("Study Type", loadStudy.type),
    detailRow("Interpretation Scope", studyClassification.scopeLabel),
    detailRow("Asset", loadStudy.asset),
    detailRow("Recorded Duration", duration.total),
    detailRow("Monitoring File Size", formatFileSize(loadStudy.file_size_kb)),
  ].filter(isDetailRow);
  const installationDetails = [
    detailRow("Panel Configuration", observations.panel_configuration),
    detailRow("System Type", observations.system_type),
    detailRow("Main Breaker Note", observations.main_breaker_note),
    detailRow("Conductors", joinParts([joinList(conductors.materials), joinList(conductors.temperature_ratings)])),
    detailRow("Wiring Method", joinParts([wiring.type, wiring.conduit])),
    detailRow("Phase Identification", joinList(wiring.phases_colors)),
    detailRow("Neutral Identification", wiring.neutral_color),
    detailRow("NEC Articles", joinList(compliance.nec_articles)),
    detailRow(
      "Permitted Usage",
      joinList(compliance.usage),
    ),
  ].filter(isDetailRow);
  const recommendations = buildRecommendations({
    phaseImbalance,
    breakerNote: observations.main_breaker_note,
    panelRating: capacity.max_amperage,
    breakerRating: breaker.amperage,
    systemType: observations.system_type,
  });
  const aiAnalysis = buildAiAnalysis({
    panelName,
    assetName: loadStudy.asset || panelName,
    studyType: studyClassification.reportLabel,
    overallAverageLoad,
    peakDemand,
    phaseImbalance,
    mad,
    mcl,
    baseLoad,
    totalConnectedLoad,
    projectedLoad,
    phaseSummaries,
    weeklySummaries,
    breakerNote: observations.main_breaker_note,
  });

  return {
    companyName: COMPANY_INFO.name,
    companyLicense: COMPANY_INFO.license,
    companyPhone: COMPANY_INFO.phone,
    companyWebsite: COMPANY_INFO.website,
    companyAddress: `${COMPANY_INFO.addressLine1} | ${COMPANY_INFO.addressLine2}`,
    companyLogoSrc: COMPANY_INFO.logoSrc,
    clientName: options.clientName.trim(),
    address: options.address.trim(),
    equipment: loadStudy.device || "Fluke 1736 Power Logger",
    reportDate: formatDateTime(new Date().toISOString()),
    studyPeriod: buildStudyPeriod(loadStudyStart, loadStudyEnd),
    studyType: studyClassification.reportLabel,
    scopeLabel: studyClassification.scopeLabel,
    assetName: loadStudy.asset || panelName,
    panelName,
    rows,
    panelDetails,
    loadStudyDetails,
    installationDetails,
    overallAverageLoad,
    peakDemand,
    phaseSummaries,
    weeklySummaries,
    mad,
    mcl,
    baseLoad,
    totalConnectedLoad,
    projectedLoad,
    phaseImbalance,
    interpretationNotices,
    aiAnalysis,
    keyFindings: buildKeyFindings({
      overallAverageLoad,
      peakDemand,
      phaseImbalance,
      mcl,
      totalConnectedLoad,
      baseLoad,
    }),
    recommendations,
  };
}

function buildPhaseSummaries(rows: ParserRow[]): PhaseSummary[] {
  return [
    { key: "a", label: "Phase A", voltageKey: "load_calc_nominal_ln_voltage_a" },
    { key: "b", label: "Phase B", voltageKey: "load_calc_nominal_ln_voltage_b" },
    { key: "c", label: "Phase C", voltageKey: "load_calc_nominal_ln_voltage_c" },
  ].map((phase) => ({
    label: phase.label,
    averageKva: safeAverage(
      rows.map((row) =>
        apparentPowerKva(
          asNumber(row[phase.voltageKey]),
          asNumber(row[`load_calc_phase_${phase.key}_current_avg`]),
        ),
      ),
    ),
    peakKva: safeMax(
      rows.map((row) =>
        apparentPowerKva(
          asNumber(row[phase.voltageKey]),
          asNumber(row[`load_calc_phase_${phase.key}_current_max`]),
        ),
      ),
    ),
    minimumKva: safeMin(
      rows.map((row) =>
        apparentPowerKva(
          asNumber(row[phase.voltageKey]),
          asNumber(row[`load_calc_phase_${phase.key}_current_min`]),
        ),
      ),
    ),
  }));
}

function buildWeeklySummaries(rows: ParserRow[]): WeeklySummary[] {
  const buckets = new Map<string, ParserRow[]>();

  for (const row of rows) {
    const timestamp = toTimestamp(row.started_at_utc);
    if (timestamp === null) continue;
    const weekStart = startOfWeekUtc(timestamp);
    const key = weekStart.toISOString();
    const existing = buckets.get(key);
    if (existing) {
      existing.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartIso, bucket]) => {
      const start = new Date(weekStartIso);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const values = bucket.map((row) => totalEstimatedKva(row));
      return {
        label: formatWeekRange(start, end),
        average: safeAverage(values),
        peak: safeMax(values),
        minimum: safeMin(values),
      };
    });
}

function buildKeyFindings({
  overallAverageLoad,
  peakDemand,
  phaseImbalance,
  mcl,
  totalConnectedLoad,
  baseLoad,
}: {
  overallAverageLoad: number;
  peakDemand: number;
  phaseImbalance: number;
  mcl: number;
  totalConnectedLoad: number;
  baseLoad: number;
}) {
  const findings = [
    `The monitored system carried an estimated average apparent load of ${formatKva(overallAverageLoad)} with a peak demand of ${formatKva(peakDemand)}.`,
    `The estimated base load remained around ${formatKw(baseLoad)}, indicating the minimum sustained demand present during the study period.`,
    `The calculated maximum continuous load is ${formatKw(mcl)}, using a 125% factor on the maximum average demand.`,
  ];

  if (phaseImbalance > 10) {
    findings.push(`Phase loading shows an estimated imbalance of ${phaseImbalance.toFixed(1)}%, which warrants load redistribution review.`);
  } else {
    findings.push(`Phase loading stayed reasonably balanced, with an estimated average imbalance of ${phaseImbalance.toFixed(1)}%.`);
  }

  if (mcl > totalConnectedLoad) {
    findings.push("Continuous loading margin is tighter than the observed peak connected demand and should be reviewed against feeder and breaker capacity.");
  } else {
    findings.push("Observed connected demand remains below the calculated continuous loading threshold, indicating acceptable short-term utilization.");
  }

  return findings;
}

function buildReportHtml(summary: ReturnType<typeof buildReportSummary>) {
  const phaseChart = buildPhaseBarChart(summary.phaseSummaries);
  const weeklyChart = buildWeeklyLineChart(summary.weeklySummaries);
  const distributionChart = buildDistributionDonutChart([
    { label: "Base Load", value: summary.baseLoad, color: "#b5402a" },
    { label: "MCL", value: summary.mcl, color: "#2f6fdf" },
    { label: "Projected", value: summary.projectedLoad, color: "#2f8a57" },
  ]);
  const interactiveExplorer = buildInteractiveReportExplorer(summary.rows, summary.studyPeriod);

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Electrical Load Study Report</title>
      <style>
        @page { size: A4; margin: 18mm; }
        body { font-family: Georgia, "Times New Roman", serif; color: #1f1a14; margin: 0; }
        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
        .cover { min-height: 96vh; display: flex; flex-direction: column; justify-content: center; }
        h1, h2, h3 { margin: 0 0 10px; }
        h1 { font-size: 30px; }
        h2 { font-size: 20px; margin-top: 28px; border-bottom: 1px solid #d9cdbb; padding-bottom: 6px; }
        h3 { font-size: 15px; margin-top: 18px; }
        p, li { font-size: 11px; line-height: 1.6; }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.16em; color: #8e3a2d; font-size: 10px; margin-bottom: 12px; }
        .meta-grid, .stats-grid, .chart-grid { display: grid; gap: 14px; }
        .meta-grid { grid-template-columns: 1fr 1fr; margin-top: 22px; }
        .stats-grid { grid-template-columns: repeat(3, 1fr); margin-top: 16px; }
        .chart-grid { grid-template-columns: 1fr; margin-top: 16px; }
        .card { border: 1px solid #d9cdbb; border-radius: 14px; padding: 14px; background: #fcfaf7; }
        .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #6e5f4f; margin-bottom: 6px; }
        .value { font-size: 18px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #d9cdbb; padding: 8px; font-size: 10px; text-align: left; }
        th { background: #f3ece2; }
        .small { color: #6e5f4f; font-size: 10px; }
        .two-col { display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 16px; align-items: start; }
        .list-tight { margin: 0; padding-left: 18px; }
        .chart-box { border: 1px solid #d9cdbb; border-radius: 14px; padding: 10px; background: #fffdfa; }
        .cover-head { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: stretch; margin-bottom: 22px; }
        .hero-card { border: 1px solid #d9cdbb; border-radius: 18px; padding: 18px; background: linear-gradient(180deg, #fffdfa 0%, #f8f1e7 100%); min-height: 220px; }
        .hero-company { display: grid; grid-template-columns: 120px 1fr; gap: 16px; align-items: center; }
        .company-logo { width: 120px; max-width: 100%; height: auto; object-fit: contain; }
        .hero-title { font-size: 28px; line-height: 1.1; margin-bottom: 10px; }
        .hero-kicker { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #6e5f4f; margin-bottom: 12px; }
        .info-stack { display: grid; gap: 8px; margin-top: 14px; }
        .info-row { display: grid; grid-template-columns: 108px 1fr; gap: 10px; font-size: 11px; }
        .info-row strong { color: #6e5f4f; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
        .hero-note { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d9cdbb; }
        .analysis-box { margin-top: 14px; padding: 14px; border-radius: 14px; border: 1px solid #d9cdbb; background: #fdf9f4; }
        .notice-grid { display: grid; gap: 12px; margin-top: 14px; }
        .notice-box { border: 1px solid #d6c9b4; border-left: 4px solid #8e3a2d; border-radius: 14px; padding: 12px 14px; background: #fff8ef; }
        .interactive-grid { display: grid; gap: 14px; grid-template-columns: 1fr; margin-top: 14px; }
        .interactive-explorer { border: 1px solid #d9cdbb; border-radius: 16px; background: linear-gradient(180deg, #fffdfa 0%, #fbf6ef 100%); padding: 14px; }
        .interactive-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; border: 1px solid #d9cdbb; background: #fffdfa; color: #6e5f4f; font-size: 10px; }
        .control-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 14px; }
        .control-group { display: grid; gap: 8px; }
        .button-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .ghost-button { border: 1px solid rgba(142,58,45,0.18); background: rgba(255,253,250,0.95); color: #1f1a14; border-radius: 999px; padding: 8px 10px; cursor: pointer; font: inherit; font-size: 10px; }
        .ghost-button.active { background: #f3ece2; border-color: rgba(142,58,45,0.42); }
        .phase-toggle.active { color: #fffdfa; border-color: transparent; }
        .control-label { display: grid; gap: 6px; color: #6e5f4f; font-size: 10px; }
        .control-label input { width: 100%; }
        .chart-shell { margin-top: 14px; border: 1px solid #d9cdbb; border-radius: 14px; background: rgba(255,255,255,0.82); padding: 10px; }
        .interactive-svg { width: 100%; height: auto; display: block; overflow: visible; }
        .legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; color: #6e5f4f; font-size: 10px; }
        .legend-item { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
        .legend-item.off { opacity: 0.45; }
        .dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
        .mini-stats { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }
        .mini-card { border: 1px solid #d9cdbb; border-radius: 12px; background: #fffdfa; padding: 10px; }
        .mini-row { display: flex; justify-content: space-between; gap: 10px; font-size: 10px; margin-top: 6px; }
        .mini-row span { color: #6e5f4f; }
        .table-wrap { margin-top: 12px; overflow: auto; border: 1px solid #d9cdbb; border-radius: 12px; background: #fffdfa; }
        .table-actions { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .table-hidden .table-wrap, .table-hidden .table-actions { display: none; }
        .chart-note { color: #6e5f4f; font-size: 10px; margin-top: 8px; }
        @media print {
          .ghost-button, .control-label input { display: none; }
        }
      </style>
    </head>
    <body>
      <section class="page cover">
        <div class="cover-head">
          <div class="hero-card">
            <div class="eyebrow">Prepared By</div>
            <div class="hero-company">
              <img class="company-logo" src="${escapeHtml(summary.companyLogoSrc)}" alt="${escapeHtml(summary.companyName)}" onerror="this.style.display='none'" />
              <div>
                <div class="hero-title">${escapeHtml(summary.companyName)}</div>
                <div class="hero-kicker">Electrical Study & Engineering Support</div>
                <div class="info-stack">
                  <div class="info-row"><strong>License</strong><span>${escapeHtml(summary.companyLicense)}</span></div>
                  <div class="info-row"><strong>Phone</strong><span>${escapeHtml(summary.companyPhone)}</span></div>
                  <div class="info-row"><strong>Website</strong><span>${escapeHtml(summary.companyWebsite)}</span></div>
                  <div class="info-row"><strong>Office</strong><span>${escapeHtml(summary.companyAddress)}</span></div>
                </div>
              </div>
            </div>
          </div>
          <div class="hero-card">
            <div class="eyebrow">Client Delivery Report</div>
            <h1>Electrical Load Study Report</h1>
            <p class="small">Prepared for technical review, planning, and client delivery.</p>
            <div class="info-stack">
              <div class="info-row"><strong>Client</strong><span>${escapeHtml(summary.clientName)}</span></div>
              <div class="info-row"><strong>Project</strong><span>${escapeHtml(summary.address)}</span></div>
              <div class="info-row"><strong>Asset</strong><span>${escapeHtml(summary.assetName)}</span></div>
              <div class="info-row"><strong>Panel</strong><span>${escapeHtml(summary.panelName)}</span></div>
              <div class="info-row"><strong>Scope</strong><span>${escapeHtml(summary.scopeLabel)}</span></div>
              <div class="info-row"><strong>Study Period</strong><span>${escapeHtml(summary.studyPeriod)}</span></div>
              <div class="info-row"><strong>Report Date</strong><span>${escapeHtml(summary.reportDate)}</span></div>
            </div>
            <p class="small hero-note">This report summarizes monitored load profile, demand behavior, phase balance, and planning metrics for the referenced electrical asset. It is intentionally scoped as a load study interpretation unless power-quality channels are explicitly present in the source dataset.</p>
          </div>
        </div>
        <div class="meta-grid">
          ${metaCard("Company", summary.companyName)}
          ${metaCard("License", summary.companyLicense)}
          ${metaCard("Client", summary.clientName)}
          ${metaCard("Address", summary.address)}
          ${metaCard("Phone", summary.companyPhone)}
          ${metaCard("Date of Report", summary.reportDate)}
          ${metaCard("Website", summary.companyWebsite)}
          ${metaCard("Equipment Used", summary.equipment)}
          ${metaCard("Study Period", summary.studyPeriod)}
          ${metaCard("Office", summary.companyAddress)}
        </div>
      </section>

      <section class="page">
        <h2>1. Introduction</h2>
        <p>This electrical load study was prepared to evaluate three-phase loading behavior, identify demand characteristics, and support engineering decisions related to system utilization and future capacity planning for panel ${escapeHtml(summary.panelName)}.</p>
        <p>The scope of the analysis covers phase loading, trend review, apparent demand estimation, and high-level system observations derived from the parsed monitoring dataset. Continuous load monitoring is important because it exposes true operating demand, reveals imbalance or peak loading conditions, and supports more reliable design and upgrade decisions than nameplate assumptions alone.</p>

        <h2>2. Methodology</h2>
        <p>A ${escapeHtml(summary.equipment)} configured as a ${escapeHtml(summary.studyType)} was used to capture continuous electrical measurements over the reported study period for asset ${escapeHtml(summary.assetName)}. The monitoring dataset was parsed and reduced for engineering review while preserving the time sequence of the measured intervals.</p>
        <p>Data validation included chronological ordering checks, field extraction verification, and consistency review of current, voltage, and power-related channels. Estimated kVA values in this report are derived from the monitored current data and the available nominal line-to-neutral voltage channels when direct kVA channels are not present in the source file.</p>
        <div class="notice-grid">
          ${summary.interpretationNotices
            .map(
              (notice) => `<div class="notice-box">
                <h3>${escapeHtml(notice.title)}</h3>
                <p>${escapeHtml(notice.body)}</p>
              </div>`,
            )
            .join("")}
        </div>

        <h2>3. Panel and Study Information</h2>
        <div class="two-col">
          <div>
            ${buildDetailsTable("Panel Details", summary.panelDetails)}
            ${buildDetailsTable("Installation Notes", summary.installationDetails)}
          </div>
          <div>
            ${buildDetailsTable("Monitoring Details", summary.loadStudyDetails)}
          </div>
        </div>

        <h2>4. Executive Summary</h2>
        <div class="stats-grid">
          ${statCard("Overall System Average Load", formatKva(summary.overallAverageLoad))}
          ${statCard("Peak Demand", formatKva(summary.peakDemand))}
          ${statCard("Phase Imbalance", `${summary.phaseImbalance.toFixed(1)}%`)}
        </div>
        <ul class="list-tight">
          ${summary.keyFindings.map((item) => `<li>${item}</li>`).join("")}
        </ul>

        <h2>5. AI-Generated Analysis</h2>
        <p>This section was generated automatically from the monitored dataset to provide an additional narrative interpretation of the study results. The text is constrained to load-study scope and avoids power-quality compliance claims unless those channels exist in the parsed source.</p>
        ${summary.aiAnalysis
          .map(
            (section) => `<div class="analysis-box">
              <h3>${escapeHtml(section.title)}</h3>
              <p>${escapeHtml(section.body)}</p>
            </div>`,
          )
          .join("")}

        <h2>6. Phase Analysis</h2>
        <table>
          <thead>
            <tr><th>Phase</th><th>Average kVA</th><th>Peak kVA</th><th>Minimum kVA</th></tr>
          </thead>
          <tbody>
            ${summary.phaseSummaries
              .map(
                (phase) => `<tr>
                  <td>${phase.label}</td>
                  <td>${formatKva(phase.averageKva)}</td>
                  <td>${formatKva(phase.peakKva)}</td>
                  <td>${formatKva(phase.minimumKva)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>

        <h2>7. Graphs</h2>
        <div class="chart-grid">
          <div class="chart-box">
            <h3>Phase Comparison: Average vs Peak vs Minimum</h3>
            ${phaseChart}
          </div>
          <div class="chart-box">
            <h3>Weekly Load Trend</h3>
            ${weeklyChart}
          </div>
          <div class="chart-box">
            <h3>Load Distribution</h3>
            ${distributionChart}
          </div>
        </div>
        <div class="interactive-grid">
          <div class="chart-box">
            <h3>Interactive Phase Charts</h3>
            <p class="small">Open this HTML report in a browser to interact with the three phase charts. Use the mouse wheel for zoom and drag horizontally for paneo.</p>
            ${interactiveExplorer}
          </div>
        </div>
      </section>

      <section class="page">
        <h2>8. Weekly Analysis</h2>
        <table>
          <thead>
            <tr><th>Week</th><th>Average kVA</th><th>Peak kVA</th><th>Minimum kVA</th></tr>
          </thead>
          <tbody>
            ${summary.weeklySummaries
              .map(
                (week) => `<tr>
                  <td>${week.label}</td>
                  <td>${formatKva(week.average)}</td>
                  <td>${formatKva(week.peak)}</td>
                  <td>${formatKva(week.minimum)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <p>The weekly trend was reviewed using actual calendar weeks overlapped by the monitored study period. This view highlights the relative stability of the load profile and helps identify demand swings, elevated loading windows, or unusually low-demand periods.</p>

        <h2>9. Load Calculations</h2>
        <table>
          <thead>
            <tr><th>Metric</th><th>Value</th><th>Basis</th></tr>
          </thead>
          <tbody>
            <tr><td>Maximum Average Demand (MAD)</td><td>${formatKw(summary.mad)}</td><td>Maximum observed total average kW</td></tr>
            <tr><td>Maximum Continuous Load (MCL)</td><td>${formatKw(summary.mcl)}</td><td>125% of MAD</td></tr>
            <tr><td>Base Load</td><td>${formatKw(summary.baseLoad)}</td><td>Minimum observed total average kW</td></tr>
            <tr><td>Total Connected Load</td><td>${formatKw(summary.totalConnectedLoad)}</td><td>Maximum observed total peak kW</td></tr>
            <tr><td>Projected Load</td><td>${formatKw(summary.projectedLoad)}</td><td>15% planning adder over the governing load metric</td></tr>
          </tbody>
        </table>

        <h2>10. System Evaluation</h2>
        <p>The monitored electrical system exhibits an estimated phase imbalance of ${summary.phaseImbalance.toFixed(1)}% based on average phase apparent load. Values above typical balancing targets should be reviewed to reduce conductor heating, neutral loading effects, and uneven utilization of upstream equipment.</p>
        <p>Overload risk should be evaluated by comparing the calculated continuous loading threshold and projected demand against the ratings of the serving distribution equipment. The documented panel configuration and installed protective device information were considered qualitatively in this review to highlight potential capacity constraints and coordination considerations.</p>
        <p>Capacity observations indicate that the system is best evaluated not only on observed peak behavior but also on sustained loading, since continuous demand often governs design and code compliance more strongly than short-duration peaks. This report does not treat the parsed load-calculation dataset as a substitute for a full power-quality assessment under the Fluke 174x methodology.</p>

        <h2>11. Recommendations</h2>
        <ul class="list-tight">
          ${summary.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>

        <h2>12. Conclusion</h2>
        <p>This load study provides a structured engineering view of the monitored three-phase electrical system using the parsed monitoring dataset. The report identifies characteristic loading levels, estimated apparent demand by phase, weekly trends, and planning metrics intended to support technical decision-making.</p>
        <p>Final engineering consideration should include comparison of these results against installed equipment ratings, operating schedules, and any anticipated future load growth before design changes or equipment upgrades are authorized. If harmonic distortion, flicker, voltage events, or compliance questions matter, those conclusions should come from the appropriate Fluke PQ intervals and event records rather than from this load-study export alone.</p>
      </section>
      <script>
        ${buildReportInteractiveScript(summary.rows)}
      </script>
    </body>
  </html>`;
}

function buildAiAnalysis({
  panelName,
  assetName,
  studyType,
  overallAverageLoad,
  peakDemand,
  phaseImbalance,
  mad,
  mcl,
  baseLoad,
  totalConnectedLoad,
  projectedLoad,
  phaseSummaries,
  weeklySummaries,
  breakerNote,
}: {
  panelName: string;
  assetName: string;
  studyType: string;
  overallAverageLoad: number;
  peakDemand: number;
  phaseImbalance: number;
  mad: number;
  mcl: number;
  baseLoad: number;
  totalConnectedLoad: number;
  projectedLoad: number;
  phaseSummaries: PhaseSummary[];
  weeklySummaries: WeeklySummary[];
  breakerNote?: string;
}): AiAnalysisSection[] {
  const highestPhase = phaseSummaries.reduce((current, phase) =>
    phase.averageKva > current.averageKva ? phase : current,
  );
  const lowestPhase = phaseSummaries.reduce((current, phase) =>
    phase.averageKva < current.averageKva ? phase : current,
  );
  const weeklyPeak = weeklySummaries.reduce((current, week) =>
    week.peak > current.peak ? week : current,
  );
  const weeklyLow = weeklySummaries.reduce((current, week) =>
    week.minimum < current.minimum ? week : current,
  );
  const utilizationRatio = peakDemand > 0 ? overallAverageLoad / peakDemand : 0;
  const imbalanceRisk =
    phaseImbalance > 15 ? "high" : phaseImbalance > 10 ? "moderate" : "controlled";
  const loadShape =
    utilizationRatio > 0.82
      ? "The load profile appears relatively dense, which suggests the system spent much of the monitored period operating close to its upper observed demand."
      : utilizationRatio > 0.6
        ? "The load profile appears moderately variable, showing meaningful swings between typical operation and peak loading."
        : "The load profile appears strongly variable, indicating that short-duration peaks are notably higher than the system's normal operating load.";
  const planningDelta = projectedLoad - peakDemand;

  return [
    {
      title: "Operational Load Narrative",
      body:
        `${panelName} and asset ${assetName} were evaluated from the ${studyType.toLowerCase()} dataset. ` +
        `The monitored system carried an estimated average load of ${formatKva(overallAverageLoad)} and reached a peak of ${formatKva(peakDemand)}. ` +
        `${loadShape} The estimated base load of ${formatKw(baseLoad)} indicates the minimum sustained demand that remained present during lower-use intervals.`,
    },
    {
      title: "Phase Balance Interpretation",
      body:
        `${highestPhase.label} carried the highest average apparent load at ${formatKva(highestPhase.averageKva)}, while ${lowestPhase.label} carried the lowest at ${formatKva(lowestPhase.averageKva)}. ` +
        `The resulting phase imbalance of ${phaseImbalance.toFixed(1)}% is considered ${imbalanceRisk}. ` +
        (phaseImbalance > 10
          ? "This pattern suggests that selective redistribution of single-phase loads could improve utilization symmetry and reduce uneven thermal stress."
          : "This pattern suggests that phase loading remained generally acceptable over the monitored interval."),
    },
    {
      title: "Capacity and Planning Outlook",
      body:
        `The maximum average demand (MAD) was ${formatKw(mad)}, resulting in a maximum continuous load (MCL) estimate of ${formatKw(mcl)}. ` +
        `Observed connected demand reached ${formatKw(totalConnectedLoad)}, while the projected planning load rises to ${formatKw(projectedLoad)}. ` +
        (planningDelta > 0
          ? `Relative to the observed peak, the projection adds ${formatKva(planningDelta)} of planning headroom that should be checked directly against breaker, feeder, and upstream equipment ratings. `
          : "The projected planning load does not materially exceed the observed peak, so present operating demand already defines the governing capacity condition. ") +
        (breakerNote
          ? `${breakerNote}.`
          : "This comparison should be confirmed against installed protective device and distribution equipment ratings."),
    },
    {
      title: "Trend and Variability Review",
      body:
        `Within the weekly segmentation used in this report, the strongest peak behavior appeared in ${weeklyPeak.label} at ${formatKva(weeklyPeak.peak)}, while the lightest minimum demand appeared in ${weeklyLow.label} at ${formatKva(weeklyLow.minimum)}. ` +
        `This spread helps distinguish recurring operating demand from isolated high-load intervals and identifies the periods most suitable for follow-up monitoring or operational review.`,
    },
  ];
}

function classifyStudyDataset({
  declaredStudyType,
  availableFieldNames,
}: {
  declaredStudyType?: string;
  availableFieldNames: Set<string>;
}) {
  const normalized = (declaredStudyType || "").toLowerCase();
  const hasOnlyLoadCalcFields =
    availableFieldNames.size > 0 &&
    [...availableFieldNames].every((fieldName) => fieldName.startsWith("load_calc_"));

  if (normalized.includes("load")) {
    return {
      reportLabel: declaredStudyType || "Load Study",
      scopeLabel: "Load Study interpretation",
    };
  }

  if (hasOnlyLoadCalcFields) {
    return {
      reportLabel: declaredStudyType || "Load calculation dataset",
      scopeLabel: "Load Study interpretation",
    };
  }

  return {
    reportLabel: declaredStudyType || "Electrical monitoring dataset",
    scopeLabel: "Mixed electrical interpretation",
  };
}

function buildInterpretationNotices({
  studyClassification,
  availableFieldNames,
}: {
  studyClassification: { reportLabel: string; scopeLabel: string };
  availableFieldNames: Set<string>;
}): InterpretationNotice[] {
  const notices: InterpretationNotice[] = [
    {
      title: "Load Study Scope",
      body:
        `This parsed session is being treated as a ${studyClassification.scopeLabel.toLowerCase()} under the Fluke 174x manual rules. The report is intended for loading, demand, phase balance, and capacity review rather than formal power-quality compliance conclusions.`,
    },
    {
      title: "Estimated Apparent Demand",
      body:
        "Apparent power values in this report are estimated from nominal line-to-neutral voltage and measured current where direct kVA channels are not present. They are useful for planning and comparison, but they should not be presented as direct instrument-measured PQ values.",
    },
  ];

  const hasPowerQualityFamilies =
    [...availableFieldNames].some((fieldName) => /thd|tdd|flicker|event|harmonic|interharmonic|unbalance/.test(fieldName));

  if (!hasPowerQualityFamilies) {
    notices.push({
      title: "Power Quality Limits",
      body:
        "This dataset does not expose parsed THD, TDD, flicker, harmonic, interharmonic, or event channels in the current workflow. Following the 174x manual, any statements about PQ compliance should be deferred until the relevant 10-minute PQ intervals or event-triggered records are available.",
    });
  }

  notices.push({
    title: "174x Timing Context",
    body:
      "The Fluke 174x documentation distinguishes trend, demand, PQ 10-minute, 150/180-cycle, and event-triggered records. This report uses the parsed load-calculation trend-style data and should not be interpreted as if it were a full PQ interval report.",
    });

  return notices;
}

function buildInteractiveReportExplorer(rows: ParserRow[], studyPeriod: string) {
  return `<div class="interactive-explorer" id="report-explorer">
    <div class="interactive-head">
      <div>
        <div class="eyebrow">Interactive Explorer</div>
        <h3 style="margin-bottom:6px;">Original app chart set</h3>
        <p class="small">The exported report now includes the same chart groups used in the app: combined phases, per-phase, voltage, totals, and frequency.</p>
      </div>
      <div class="pill" id="report-window-label">${escapeHtml(studyPeriod)}</div>
    </div>

    <div class="control-grid">
      <div class="control-group">
        <strong>Panel</strong>
        <div class="button-row" id="report-panel-buttons"></div>
      </div>
      <div class="control-group">
        <strong>Preset</strong>
        <div class="button-row" id="report-preset-buttons"></div>
        <label class="control-label" id="report-date-wrap">
          Anchor date
          <input id="report-anchor-date" type="date" />
        </label>
      </div>
      <div class="control-group">
        <strong>Visible window</strong>
        <label class="control-label">
          Start
          <input id="report-window-start" type="range" min="0" max="95" value="0" />
        </label>
        <label class="control-label">
          End
          <input id="report-window-end" type="range" min="5" max="100" value="100" />
        </label>
      </div>
      <div class="control-group">
        <strong>Table</strong>
        <div class="button-row">
          <button id="report-table-toggle" class="ghost-button" type="button">Hide table</button>
        </div>
        <div class="button-row" id="report-phase-toggles"></div>
      </div>
    </div>

    <div class="chart-shell">
      <div id="report-chart-host"></div>
      <div class="legend" id="report-legend"></div>
      <p class="chart-note">Mouse wheel to zoom, drag to pan, and click legend items to hide or show series.</p>
    </div>

    <div class="mini-stats" id="report-stats-grid"></div>

    <div id="report-table-section">
      <div class="table-wrap">
        <table>
          <thead id="report-table-head"></thead>
          <tbody id="report-table-body"></tbody>
        </table>
      </div>
      <div class="table-actions">
        <span class="small" id="report-page-label"></span>
        <div class="button-row">
          <button id="report-prev-page" class="ghost-button" type="button">Previous</button>
          <button id="report-next-page" class="ghost-button" type="button">Next</button>
        </div>
      </div>
    </div>
  </div>`;
}

function buildReportInteractiveScript(rows: ParserRow[]) {
  return `
const REPORT_PHASE_ROWS = ${safeJson(rows)};
(function () {
  const PANELS = {
    combined: {
      title: "Combined View",
      series: [
        { key: "load_calc_phase_a_current_avg", label: "Phase A", color: "#b5402a", phase: "phase_a" },
        { key: "load_calc_phase_b_current_avg", label: "Phase B", color: "#2f6fdf", phase: "phase_b" },
        { key: "load_calc_phase_c_current_avg", label: "Phase C", color: "#2f8a57", phase: "phase_c" },
      ],
    },
    phase_a: {
      title: "Phase A",
      series: [
        { key: "load_calc_phase_a_current_avg", label: "Current Avg", color: "#b5402a" },
        { key: "load_calc_phase_a_kw_avg", label: "kW Avg", color: "#cf9334" },
        { key: "load_calc_phase_a_current_reference", label: "Current Ref", color: "#6f58a8" },
      ],
    },
    phase_b: {
      title: "Phase B",
      series: [
        { key: "load_calc_phase_b_current_avg", label: "Current Avg", color: "#2f6fdf" },
        { key: "load_calc_phase_b_kw_avg", label: "kW Avg", color: "#7aa4ec" },
        { key: "load_calc_phase_b_current_reference", label: "Current Ref", color: "#6f58a8" },
      ],
    },
    phase_c: {
      title: "Phase C",
      series: [
        { key: "load_calc_phase_c_current_avg", label: "Current Avg", color: "#2f8a57" },
        { key: "load_calc_phase_c_kw_avg", label: "kW Avg", color: "#68b37a" },
        { key: "load_calc_phase_c_current_reference", label: "Current Ref", color: "#6f58a8" },
      ],
    },
    voltage: {
      title: "Voltage",
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
      series: [
        { key: "load_calc_total_kw_avg", label: "Total kW Avg", color: "#6f58a8" },
        { key: "load_calc_total_kw_max", label: "Total kW Max", color: "#cf9334" },
        { key: "load_calc_total_current_reference_1", label: "Total Current Ref", color: "#2f7d7d" },
      ],
    },
    frequency: {
      title: "Frequency",
      series: [
        { key: "load_calc_frequency_min", label: "Frequency Min", color: "#8c6a2d" },
        { key: "load_calc_frequency_avg", label: "Frequency Avg", color: "#a03f32" },
        { key: "load_calc_frequency_max", label: "Frequency Max", color: "#3f7c74" },
      ],
    },
  };
  const PRESETS = [
    { value: "study", label: "Study" },
    { value: "week", label: "Week" },
    { value: "day", label: "Day" },
  ];
  const state = {
    panel: "combined",
    preset: "study",
    anchorDate: "",
    windowStart: 0,
    windowEnd: 100,
    dragStartX: null,
    dragWindow: null,
    listenersBound: false,
    page: 0,
    showTable: true,
    hiddenSeries: {},
    phaseVisibility: { phase_a: true, phase_b: true, phase_c: true },
  };
  const els = {
    panelButtons: document.getElementById("report-panel-buttons"),
    presetButtons: document.getElementById("report-preset-buttons"),
    dateWrap: document.getElementById("report-date-wrap"),
    anchorDate: document.getElementById("report-anchor-date"),
    windowStart: document.getElementById("report-window-start"),
    windowEnd: document.getElementById("report-window-end"),
    tableToggle: document.getElementById("report-table-toggle"),
    phaseToggles: document.getElementById("report-phase-toggles"),
    chartHost: document.getElementById("report-chart-host"),
    legend: document.getElementById("report-legend"),
    statsGrid: document.getElementById("report-stats-grid"),
    tableSection: document.getElementById("report-table-section"),
    tableHead: document.getElementById("report-table-head"),
    tableBody: document.getElementById("report-table-body"),
    pageLabel: document.getElementById("report-page-label"),
    prevPage: document.getElementById("report-prev-page"),
    nextPage: document.getElementById("report-next-page"),
    windowLabel: document.getElementById("report-window-label"),
  };

  init();

  function init() {
    buildPanelButtons();
    buildPresetButtons();
    buildPhaseButtons();
    const bounds = getDateBounds(REPORT_PHASE_ROWS);
    els.anchorDate.min = bounds.min || "";
    els.anchorDate.max = bounds.max || "";
    els.anchorDate.value = bounds.max || "";
    state.anchorDate = bounds.max || "";
    els.anchorDate.addEventListener("change", function (event) {
      state.anchorDate = event.target.value;
      state.page = 0;
      render();
    });
    els.windowStart.addEventListener("input", function (event) {
      const next = Number(event.target.value);
      state.windowStart = Math.min(next, state.windowEnd - 5);
      els.windowStart.value = String(Math.round(state.windowStart));
      state.page = 0;
      render();
    });
    els.windowEnd.addEventListener("input", function (event) {
      const next = Number(event.target.value);
      state.windowEnd = Math.max(next, state.windowStart + 5);
      els.windowEnd.value = String(Math.round(state.windowEnd));
      state.page = 0;
      render();
    });
    els.tableToggle.addEventListener("click", function () {
      state.showTable = !state.showTable;
      render();
    });
    els.prevPage.addEventListener("click", function () {
      state.page = Math.max(0, state.page - 1);
      renderTable();
    });
    els.nextPage.addEventListener("click", function () {
      state.page += 1;
      renderTable();
    });
    render();
  }

  function buildPanelButtons() {
    els.panelButtons.innerHTML = Object.keys(PANELS).map(function (key) {
      return '<button type="button" class="ghost-button" data-panel="' + key + '">' + escapeHtml(PANELS[key].title) + '</button>';
    }).join("");
    els.panelButtons.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        state.panel = button.dataset.panel;
        state.page = 0;
        render();
      });
    });
  }

  function buildPresetButtons() {
    els.presetButtons.innerHTML = PRESETS.map(function (preset) {
      return '<button type="button" class="ghost-button" data-preset="' + preset.value + '">' + preset.label + '</button>';
    }).join("");
    els.presetButtons.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
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
    els.phaseToggles.innerHTML = phases.map(function (phase) {
      return '<button type="button" class="ghost-button phase-toggle" data-phase="' + phase.key + '" data-color="' + phase.color + '">' + phase.label + '</button>';
    }).join("");
    els.phaseToggles.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
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
    els.panelButtons.querySelectorAll("button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.panel === state.panel);
    });
    els.presetButtons.querySelectorAll("button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.preset === state.preset);
    });
    els.phaseToggles.querySelectorAll("button").forEach(function (button) {
      const key = button.dataset.phase;
      const active = !!state.phaseVisibility[key];
      button.classList.toggle("active", active);
      button.style.background = active ? button.dataset.color : "rgba(255,253,250,0.95)";
    });
    els.dateWrap.style.display = state.preset === "study" ? "none" : "grid";
    els.phaseToggles.style.display = state.panel === "combined" ? "flex" : "none";
    els.tableSection.classList.toggle("table-hidden", !state.showTable);
    els.tableToggle.textContent = state.showTable ? "Hide table" : "Show table";
  }

  function getActiveSeries() {
    return PANELS[state.panel].series.filter(function (series) {
      if (series.phase && !state.phaseVisibility[series.phase]) return false;
      if (state.hiddenSeries[series.key]) return false;
      return true;
    });
  }

  function getScopedRows() {
    const presetRows = applyPreset(REPORT_PHASE_ROWS, state.preset, state.anchorDate);
    const total = presetRows.length;
    if (!total) return { rows: [], label: "No visible data" };
    const startIndex = Math.floor((state.windowStart / 100) * Math.max(total - 1, 0));
    const endIndex = Math.max(startIndex + 1, Math.ceil((state.windowEnd / 100) * total));
    const rows = presetRows.slice(startIndex, endIndex);
    const startLabel = rows[0] ? formatTimestamp(rows[0].started_at_utc) : "-";
    const endLabel = rows[rows.length - 1] ? formatTimestamp(rows[rows.length - 1].started_at_utc) : "-";
    return { rows: rows, label: startLabel + " to " + endLabel };
  }

  function renderChart() {
    const scoped = getScopedRows();
    const activeSeries = getActiveSeries();
    const series = activeSeries.map(function (item) {
      return {
        key: item.key,
        label: item.label,
        color: item.color,
        values: scoped.rows.map(function (row) { return asNumber(row[item.key]); }),
      };
    }).filter(function (item) {
      return item.values.some(function (value) { return value !== null; });
    });
    els.windowLabel.textContent = scoped.label;
    if (!scoped.rows.length || !series.length) {
      els.chartHost.innerHTML = '<div class="small">No visible data for this panel.</div>';
      els.legend.innerHTML = "";
      els.statsGrid.innerHTML = "";
      return;
    }
    els.chartHost.innerHTML = buildChartSvg(series);
    bindChartInteractions();
    els.legend.innerHTML = PANELS[state.panel].series
      .filter(function (item) { return !item.phase || state.phaseVisibility[item.phase]; })
      .map(function (item) {
        const off = state.hiddenSeries[item.key] ? " off" : "";
        return '<span class="legend-item' + off + '" data-series="' + item.key + '"><span class="dot" style="background:' + item.color + '"></span>' + escapeHtml(item.label) + '</span>';
      }).join("");
    els.legend.querySelectorAll(".legend-item").forEach(function (item) {
      item.addEventListener("click", function () {
        const key = item.dataset.series;
        state.hiddenSeries[key] = !state.hiddenSeries[key];
        state.page = 0;
        render();
      });
    });
    els.statsGrid.innerHTML = series.map(function (item) {
      const numbers = item.values.filter(function (value) { return typeof value === "number"; });
      const avg = numbers.reduce(function (sum, value) { return sum + value; }, 0) / numbers.length;
      return '<div class="mini-card"><div style="display:flex;align-items:center;gap:8px;"><span class="dot" style="background:' + item.color + '"></span><strong>' + escapeHtml(item.label) + '</strong></div>' +
        miniRow("Min", formatNumber(Math.min.apply(null, numbers))) +
        miniRow("Max", formatNumber(Math.max.apply(null, numbers))) +
        miniRow("Avg", formatNumber(avg)) +
        miniRow("Visible", formatNumber(numbers[numbers.length - 1])) +
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
    els.tableHead.innerHTML = '<tr><th>Index</th><th>Start</th>' + activeSeries.map(function (item) {
      return '<th>' + escapeHtml(item.label) + '</th>';
    }).join("") + "</tr>";
    els.tableBody.innerHTML = pagedRows.map(function (row) {
      return '<tr><td>' + row.record_index + '</td><td>' + escapeHtml(formatTimestamp(row.started_at_utc)) + '</td>' + activeSeries.map(function (item) {
        return '<td>' + formatValue(asNumber(row[item.key])) + '</td>';
      }).join("") + "</tr>";
    }).join("");
    els.pageLabel.textContent = rows.length ? 'Page ' + (state.page + 1) + ' of ' + pageCount + ' · ' + rows.length + ' visible rows' : "No visible rows";
    els.prevPage.disabled = state.page === 0;
    els.nextPage.disabled = state.page >= pageCount - 1;
  }

  function buildChartSvg(series) {
    const width = 1080;
    const height = 320;
    const padding = { top: 18, right: 22, bottom: 34, left: 54 };
    const values = series.flatMap(function (item) {
      return item.values.filter(function (value) { return typeof value === "number"; });
    });
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const grid = Array.from({ length: 5 }, function (_, index) {
      const ratio = index / 4;
      const y = padding.top + innerHeight * ratio;
      const value = max - span * ratio;
      return '<line x1="' + padding.left + '" y1="' + y + '" x2="' + (width - padding.right) + '" y2="' + y + '" stroke="#ece0cf" stroke-width="1" />' +
        '<text x="' + (padding.left - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="#6e5f4f" font-size="10">' + escapeHtml(formatNumber(value)) + "</text>";
    }).join("");
    const paths = series.map(function (item) {
      const points = item.values.map(function (value, index) {
        if (value === null) return null;
        const ratioX = item.values.length <= 1 ? 0 : index / (item.values.length - 1);
        const x = padding.left + innerWidth * ratioX;
        const y = padding.top + ((max - value) / span) * innerHeight;
        return x + "," + y;
      }).filter(Boolean).join(" ");
      if (!points) return "";
      return '<polyline fill="none" stroke="' + item.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="' + points + '" />';
    }).join("");
    return '<svg id="report-interactive-svg" class="interactive-svg" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="report interactive chart">' +
      grid +
      '<line x1="' + padding.left + '" y1="' + (height - padding.bottom) + '" x2="' + (width - padding.right) + '" y2="' + (height - padding.bottom) + '" stroke="#d9cdbb" stroke-width="1.2" />' +
      paths +
      "</svg>";
  }

  function bindChartInteractions() {
    const svg = document.getElementById("report-interactive-svg");
    if (!svg) return;
    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("mousedown", startDrag);
    if (!state.listenersBound) {
      window.addEventListener("mousemove", dragChart);
      window.addEventListener("mouseup", stopDrag);
      state.listenersBound = true;
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    const currentSpan = state.windowEnd - state.windowStart;
    const nextSpan = Math.max(8, Math.min(100, currentSpan + (event.deltaY > 0 ? 8 : -8)));
    const svg = document.getElementById("report-interactive-svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
    const clamped = Math.max(0, Math.min(1, ratio));
    const center = state.windowStart + currentSpan * clamped;
    let nextStart = center - nextSpan * clamped;
    nextStart = Math.max(0, Math.min(100 - nextSpan, nextStart));
    state.windowStart = nextStart;
    state.windowEnd = nextStart + nextSpan;
    els.windowStart.value = String(Math.round(state.windowStart));
    els.windowEnd.value = String(Math.round(state.windowEnd));
    state.page = 0;
    render();
  }

  function startDrag(event) {
    state.dragStartX = event.clientX;
    state.dragWindow = { start: state.windowStart, end: state.windowEnd };
  }

  function dragChart(event) {
    if (state.dragStartX === null || !state.dragWindow) return;
    const svg = document.getElementById("report-interactive-svg");
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

  function stopDrag() {
    state.dragStartX = null;
    state.dragWindow = null;
  }

  function applyPreset(rows, preset, anchorDate) {
    if (preset === "study") return rows;
    if (!anchorDate) return rows;
    const range = buildRange(anchorDate, preset);
    return rows.filter(function (row) {
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
    const stamps = rows.map(function (row) { return toTimestamp(row.started_at_utc); }).filter(function (value) { return value !== null; });
    if (!stamps.length) return { min: "", max: "" };
    return { min: toInputDate(Math.min.apply(null, stamps)), max: toInputDate(Math.max.apply(null, stamps)) };
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

  function miniRow(label, value) {
    return '<div class="mini-row"><span>' + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();`;
}

function metaCard(label: string, value: string) {
  return `<div class="card"><div class="label">${label}</div><div>${escapeHtml(value)}</div></div>`;
}

function statCard(label: string, value: string) {
  return `<div class="card"><div class="label">${label}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function buildDetailsTable(title: string, rows: DetailRow[]) {
  if (!rows.length) return "";
  return `<div class="chart-box">
    <h3>${escapeHtml(title)}</h3>
    <table>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <th>${escapeHtml(row.label)}</th>
              <td>${escapeHtml(row.value)}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}

function apparentPowerKva(voltage: number | null, current: number | null) {
  if (!isFiniteNumber(voltage) || !isFiniteNumber(current)) return null;
  return (voltage * current) / 1000;
}

function totalEstimatedKva(row: ParserRow) {
  const total = ["a", "b", "c"]
    .map((phase) =>
      apparentPowerKva(
        asNumber(row[`load_calc_nominal_ln_voltage_${phase}`]),
        asNumber(row[`load_calc_phase_${phase}_current_avg`]),
      ),
    )
    .filter(isFiniteNumber)
    .reduce((sum, value) => sum + value, 0);
  return total;
}

function splitIntoBuckets<T>(items: T[], bucketCount: number) {
  const buckets: T[][] = [];
  const size = Math.max(1, Math.ceil(items.length / bucketCount));

  for (let index = 0; index < bucketCount; index += 1) {
    const slice = items.slice(index * size, (index + 1) * size);
    buckets.push(slice.length ? slice : []);
  }

  return buckets;
}

function safeAverage(values: Array<number | null>) {
  const filtered = values.filter(isFiniteNumber);
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function safeMax(values: Array<number | null>) {
  const filtered = values.filter(isFiniteNumber);
  return filtered.length ? Math.max(...filtered) : 0;
}

function safeMin(values: Array<number | null>) {
  const filtered = values.filter(isFiniteNumber);
  return filtered.length ? Math.min(...filtered) : 0;
}

type DetailRow = {
  label: string;
  value: string;
};

function detailRow(label: string, value: string | null | undefined): DetailRow | null {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  return { label, value: normalized };
}

function isDetailRow(value: DetailRow | null): value is DetailRow {
  return Boolean(value);
}

function joinList(values: string[] | undefined) {
  return values?.filter(Boolean).join(", ") || "";
}

function joinParts(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value && value.trim())).join(" | ");
}

function formatAmperage(value: number | undefined) {
  return typeof value === "number" ? `${value} A` : "";
}

function formatFileSize(value: number | undefined) {
  return typeof value === "number" ? `${value.toLocaleString("en-US")} KB` : "";
}

function formatSystem(phases: number | undefined, wires: number | undefined) {
  if (!phases && !wires) return "";
  return [phases ? `${phases} phase` : "", wires ? `${wires} wire` : ""]
    .filter(Boolean)
    .join(", ");
}

function formatDateOnly(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(date);
}

function toTimestamp(value: string | number | null | undefined) {
  if (typeof value !== "string") return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function startOfWeekUtc(timestamp: number) {
  const date = new Date(timestamp);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + offset);
  return start;
}

function formatWeekRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function buildRecommendations({
  phaseImbalance,
  breakerNote,
  panelRating,
  breakerRating,
  systemType,
}: {
  phaseImbalance: number;
  breakerNote?: string;
  panelRating?: number;
  breakerRating?: number;
  systemType?: string;
}) {
  const recommendations = [
    phaseImbalance > 10
      ? "Review phase loading distribution and rebalance single-phase loads to reduce measurable phase imbalance."
      : "Maintain the current phase distribution and verify that future additions preserve the observed phase balance.",
    "Compare the projected load against feeder, transformer, and overcurrent protective device ratings to confirm adequate future capacity.",
    "Continue interval-based monitoring during representative operating periods, especially after operational changes or additional connected equipment is introduced.",
    "Implement preventive review of recurring peak periods to identify process-driven spikes, startup loads, or scheduling opportunities.",
  ];

  if (breakerNote) {
    recommendations.splice(1, 0, breakerNote);
  } else if (panelRating && breakerRating && breakerRating < panelRating) {
    recommendations.splice(
      1,
      0,
      `The installed ${breakerRating} A main device is below the documented ${panelRating} A panel rating; confirm that this intentional limitation still aligns with present and projected utilization.`,
    );
  }

  if (systemType) {
    recommendations.push(`Preserve labeling, conductor identification, and maintenance practices appropriate for the documented ${systemType.toLowerCase()}.`);
  }

  return recommendations;
}

function asNumber(value: string | number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatKva(value: number) {
  return `${value.toFixed(2)} kVA`;
}

function formatKw(value: number) {
  return `${value.toFixed(2)} kW`;
}

function buildStudyPeriod(start: string | null, end: string | null) {
  if (!start || !end) return "Not available";
  return `${formatDateTime(start)} to ${formatDateTime(end)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function buildPhaseBarChart(phases: PhaseSummary[]) {
  const width = 760;
  const height = 260;
  const pad = { top: 24, right: 20, bottom: 44, left: 58 };
  const metrics = [
    { key: "averageKva", label: "Avg", color: "#b5402a" },
    { key: "peakKva", label: "Peak", color: "#2f6fdf" },
    { key: "minimumKva", label: "Min", color: "#2f8a57" },
  ] as const;
  const maxValue = Math.max(...phases.flatMap((phase) => metrics.map((metric) => phase[metric.key])), 1);
  const chartWidth = width - pad.left - pad.right;
  const groupWidth = chartWidth / phases.length;
  const barWidth = Math.min(34, groupWidth / 4);

  const bars = phases.flatMap((phase, phaseIndex) =>
    metrics.map((metric, metricIndex) => {
      const value = phase[metric.key];
      const x = pad.left + phaseIndex * groupWidth + 24 + metricIndex * (barWidth + 8);
      const barHeight = (value / maxValue) * (height - pad.top - pad.bottom);
      const y = height - pad.bottom - barHeight;
      return `<g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${metric.color}" />
        <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="10" fill="#5b4e40">${value.toFixed(1)}</text>
      </g>`;
    }),
  );

  const labels = phases
    .map((phase, phaseIndex) => {
      const x = pad.left + phaseIndex * groupWidth + groupWidth / 2;
      return `<text x="${x}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#5b4e40">${phase.label}</text>`;
    })
    .join("");

  const legend = metrics
    .map(
      (metric, index) =>
        `<g transform="translate(${pad.left + index * 92}, ${height - 238})"><rect width="12" height="12" rx="4" fill="${metric.color}" /><text x="18" y="10" font-size="11" fill="#5b4e40">${metric.label}</text></g>`,
    )
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" aria-label="Phase comparison chart">
    <rect width="${width}" height="${height}" rx="16" fill="#fffdfa" />
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cdbfaa" />
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#cdbfaa" />
    ${bars.join("")}
    ${labels}
    ${legend}
  </svg>`;
}

function buildWeeklyLineChart(weeks: WeeklySummary[]) {
  const width = 760;
  const height = 260;
  const pad = { top: 24, right: 24, bottom: 42, left: 58 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...weeks.flatMap((week) => [week.average, week.peak, week.minimum]), 1);
  const minValue = Math.min(...weeks.flatMap((week) => [week.average, week.peak, week.minimum]), 0);
  const span = Math.max(maxValue - minValue, 1);

  const series = [
    { key: "average", color: "#b5402a", label: "Average" },
    { key: "peak", color: "#2f6fdf", label: "Peak" },
    { key: "minimum", color: "#2f8a57", label: "Minimum" },
  ] as const;

  const pathFor = (key: keyof WeeklySummary) =>
    weeks
      .map((week, index) => {
        const x = pad.left + (index / Math.max(weeks.length - 1, 1)) * chartWidth;
        const y = pad.top + (1 - ((week[key] as number) - minValue) / span) * chartHeight;
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" aria-label="Weekly trend chart">
    <rect width="${width}" height="${height}" rx="16" fill="#fffdfa" />
    <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cdbfaa" />
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#cdbfaa" />
    ${series.map((item) => `<path d="${pathFor(item.key)}" fill="none" stroke="${item.color}" stroke-width="3" />`).join("")}
    ${weeks
      .map((week, index) => {
        const x = pad.left + (index / Math.max(weeks.length - 1, 1)) * chartWidth;
        return `<text x="${x}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#5b4e40">${week.label}</text>`;
      })
      .join("")}
    ${series
      .map(
        (item, index) =>
          `<g transform="translate(${pad.left + index * 102}, 18)"><rect width="12" height="12" rx="4" fill="${item.color}" /><text x="18" y="10" font-size="11" fill="#5b4e40">${item.label}</text></g>`,
      )
      .join("")}
  </svg>`;
}

function buildDistributionDonutChart(
  segments: Array<{ label: string; value: number; color: string }>,
) {
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.value, 0),
    1,
  );
  let startAngle = -Math.PI / 2;
  const cx = 160;
  const cy = 140;
  const r = 82;
  const innerR = 44;

  const paths = segments.map((segment) => {
    const sweep = (segment.value / total) * Math.PI * 2;
    const endAngle = startAngle + sweep;
    const path = donutSlicePath(cx, cy, r, innerR, startAngle, endAngle);
    startAngle = endAngle;
    return `<path d="${path}" fill="${segment.color}" />`;
  });

  return `<svg viewBox="0 0 760 280" width="100%" height="auto" aria-label="Load distribution chart">
    <rect width="760" height="280" rx="16" fill="#fffdfa" />
    <g transform="translate(34,0)">
      ${paths.join("")}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="12" fill="#6e5f4f">Load Mix</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="16" font-weight="700" fill="#1f1a14">${total.toFixed(1)} kW</text>
    </g>
    ${segments
      .map(
        (segment, index) => `<g transform="translate(360, ${68 + index * 44})">
          <rect width="14" height="14" rx="5" fill="${segment.color}" />
          <text x="24" y="12" font-size="12" fill="#1f1a14">${segment.label}: ${segment.value.toFixed(2)} kW</text>
        </g>`,
      )
      .join("")}
  </svg>`;
}

function donutSlicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
) {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const x1 = cx + Math.cos(startAngle) * outerR;
  const y1 = cy + Math.sin(startAngle) * outerR;
  const x2 = cx + Math.cos(endAngle) * outerR;
  const y2 = cy + Math.sin(endAngle) * outerR;
  const x3 = cx + Math.cos(endAngle) * innerR;
  const y3 = cy + Math.sin(endAngle) * innerR;
  const x4 = cx + Math.cos(startAngle) * innerR;
  const y4 = cy + Math.sin(startAngle) * innerR;

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

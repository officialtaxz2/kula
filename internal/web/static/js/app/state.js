/* ============================================================
   state.js — Shared application state, color palette, and
   Chart.js global configuration.
   Must be loaded FIRST before all other modules.
   ============================================================ */
'use strict';
import { readJsonPref, readPref } from './prefs.js';

// ---- State ----
export const state = {
    ws: null,
    paused: false,
    pausedManual: false,
    pausedHover: false,
    pausedZoom: false,
    connected: false,
    charts: {},
    timeRange: 300, // seconds, null when custom range
    lastPresetRange: 300,
    customFrom: null,
    customTo: null,
    dataBuffer: [],
    // Missing collection intervals are shared by every chart and rendered as
    // neutral background bands. Keeping one array avoids per-chart copies.
    historyGaps: [],
    // The API caps observations at 5,000. Each adjacent pair can also need
    // one gap marker; those markers must never evict observations.
    maxBufferSize: 10000,
    historyPointLimit: 5000,
    historyViewEnd: null, // last successful rolling snapshot, when refreshed in buckets
    historyRefreshAttempt: 0,
    liveSampleIntervalMs: null,
    collectionIntervalMs: 1000,
    retainedRanges: null,
    liveSampleIntervals: [],
    lastLiveSampleTs: null,
    reconnectDelay: 1000,
    reconnectTimer: null,
    historyLoaded: false,
    loadingHistory: false,
    queueLiveDuringHistory: false,
    historyStatus: 'idle', // idle, loading, failed, empty, partial, complete
    historyError: null,
    historyCoverage: null,
    historyRequestGeneration: 0,
    alerts: [],
    alertDropdownOpen: false,
    timeDropdownOpen: false,
    aggDropdownOpen: false,
    layoutMode: readPref('kula_layout') || 'grid',
    lastSample: null,
    joinMetrics: false, // fetched from server config
    focusMode: false,
    focusSelecting: false,
    focusVisible: readJsonPref('kula_focus_visible', null),
    currentResolution: '1s', // resolution of data currently loaded in charts
    currentSourceResolution: '1s',
    currentDownsampled: false,
    currentTier: 0,           // tier index of data currently loaded in charts
    liveQueue: [],        // samples buffered while a foreground history load replaces the view
    // The server's default_theme is in the page already (index.html), so the
    // first applyTheme() agrees with the pre-paint script instead of waiting
    // for /api/config.
    theme: readPref('kula_theme') || document.body?.dataset.defaultTheme || 'auto',
    diskSpaceMountNames: [], // Not used as datasets anymore, but kept for compatibility
    cpuTempSensorNames: [],
    diskTempSensorNames: [],
    currentAggregation: readPref('kula_aggregation') || 'avg',
    // A choice the loaded view cannot serve; restored when a later response can.
    suspendedAggregation: null,
    validAggregations: ['data'], // available choices; bucket profiles restrict individual fields
    timeZone: readPref('kula_time_zone') === 'utc' ? 'utc' : 'local',
    // One compact provenance record per timestamp. Tooltips look up this map
    // instead of copying bucket metadata onto every series in every chart.
    historyPointContexts: new Map(),
    aggFromUrl: false, // true when aggregation was set from the URL (takes precedence over server config)
    defaultAggregation: null, // server's web.default_aggregation, from /api/config; null until loaded
    netOptions: [],
    diskIoOptions: [],
    diskTempOptions: [],
    diskDevices: new Map(),
    diskSelectorSignatures: {},
    diskSpaceOptions: [],
    gpuLoadOptions: [],
    selectedNet: readPref('kula_sel_net') || null,
    selectedDiskIo: readPref('kula_sel_diskio') || null,
    selectedDiskTemp: readPref('kula_sel_disktemp') || null,
    selectedDiskSpace: readPref('kula_sel_diskspace') || null,
    selectedGpuLoad: readPref('kula_sel_gpuload') || null,
    configMax: {}, // loaded from server /api/config
    lastHistoricalTs: null,
    splitNet: readJsonPref('kula_split_net', false),
    splitDiskIo: readJsonPref('kula_split_diskio', false),
    splitDiskSpace: readJsonPref('kula_split_diskspace', false),
    splitDiskTemp: readJsonPref('kula_split_disktemp', false),
    splitGpu: readJsonPref('kula_split_gpu', false),
    splitCharts: {}, // { type: { chartKey: chartInstance } }
    // One Chart.js instance per metric type, each with one series per container.
    containerCharts: {}, // { cpu|mem|net_rx|net_tx|disk_r|disk_w: chartInstance }
    // Metadata for discovered containers: { key: { key, label, color, colorIndex } }
    containerApps: {},
    // Explicitly deselected container keys (empty Set = all selected).
    // New containers are selected by default (not listed here).
    containerExcluded: null,
    customCharts: {}, // { group_name: chartInstance }
    psuCharts: {}, // { psu_<name>: chartInstance }
    customMetricsConfig: {}, // { group_name: [{name, unit, max}, ...] } from /api/config
};

// ---- Color Palette ----
export const colors = {
    blue: '#3b82f6',
    cyan: '#06b6d4',
    green: '#10b981',
    yellow: '#f59e0b',
    orange: '#f97316',
    red: '#ef4444',
    purple: '#8b5cf6',
    pink: '#ec4899',
    teal: '#14b8a6',
    lime: '#84cc16',
    blueAlpha: 'rgba(59, 130, 246, 0.15)',
    cyanAlpha: 'rgba(6, 182, 212, 0.15)',
    greenAlpha: 'rgba(16, 185, 129, 0.15)',
    redAlpha: 'rgba(239, 68, 68, 0.15)',
    purpleAlpha: 'rgba(139, 92, 246, 0.15)',
    yellowAlpha: 'rgba(245, 158, 11, 0.15)',
    orangeAlpha: 'rgba(249, 115, 22, 0.15)',
    pinkAlpha: 'rgba(236, 72, 153, 0.15)',
};

// ---- Series roles ----
// The core charts colour each series by its job rather than by a per-chart
// pick, so blue always means the primary or incoming value and orange the
// secondary or outgoing one. Each theme has its own validated steps
// (OKLab ΔE ≥ 9 between neighbours under colour-vision deficiency, ≥ 3:1
// against the card surface); applyTheme() swaps them on a theme change.
export const seriesPalette = {
    dark: {
        c1: '#3987e5', c2: '#d95926', c3: '#199e70', c4: '#9085e9',
        c5: '#d55181', c6: '#c98500', c7: '#e66767',
        muted: '#8b96a5', strong: '#cbd5e1',
    },
    light: {
        c1: '#2a78d6', c2: '#e2622e', c3: '#16956a', c4: '#6250d6',
        c5: '#c94477', c6: '#b07400', c7: '#d63c3b',
        muted: '#64748b', strong: '#334155',
    },
};

export function seriesColor(role, theme = document.body?.classList.contains('light-mode') ? 'light' : 'dark') {
    return seriesPalette[theme]?.[role] || seriesPalette.dark[role];
}

// ---- Chart.js Global Config ----
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(55, 65, 81, 0.3)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.animation = false; // disable all animations for performance
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
Chart.defaults.plugins.legend.labels.boxHeight = 6;

// ---- Custom Tooltip Position: keep tooltip away from cursor ----
Chart.registry.plugins.get('tooltip'); // ensure plugin is ready
Chart.Tooltip.positioners.awayFromCursor = function (elements, eventPosition) {
    const chart = this.chart;
    const tooltipWidth = this.width || 180;
    const tooltipHeight = this.height || 80;
    const offset = 18; // gap between tooltip and cursor

    // Mouse position relative to canvas
    const mx = eventPosition.x;
    const my = eventPosition.y;

    // Try right of cursor first, fallback to left
    let x = mx + offset;
    if (x + tooltipWidth > chart.chartArea.right + 10) {
        x = mx - tooltipWidth - offset;
    }
    // Clamp horizontally within canvas
    x = Math.max(0, Math.min(x, chart.width - tooltipWidth));

    // Vertically: prefer above cursor, fallback to below
    let y = my - tooltipHeight - offset;
    if (y < 0) {
        y = my + offset;
    }
    // Clamp vertically within canvas
    y = Math.max(0, Math.min(y, chart.height - tooltipHeight));

    return { x, y };
};

// ---- Shared Helpers ----
// Line icons for buttons the scripts create, drawn like the header's inline
// SVGs (style.css .icon) so chart cards match the top bar.
const LINE_ICONS = {
    expand: [['path', { d: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5' }]],
    image: [['path', { d: 'M4 8h3l2-2.5h6L17 8h3v11H4z' }], ['circle', { cx: 12, cy: 13, r: 3.5 }]],
    bounds: [['path', { d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }], ['circle', { cx: 16, cy: 7, r: 2 }], ['circle', { cx: 10, cy: 17, r: 2 }]],
    split: [['rect', { x: 4, y: 4, width: 16, height: 6.5, rx: 1.5 }], ['rect', { x: 4, y: 13.5, width: 16, height: 6.5, rx: 1.5 }]],
    join: [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1.5 }]],
};

export function lineIcon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of LINE_ICONS[name] || []) {
        const part = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, value);
        svg.append(part);
    }
    return svg;
}

export const escapeHTML = (str) => String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// Stored Y-axis bounds per chart: { [graphId]: { mode, value, auto } }.
export function graphMaxPrefs() {
    const prefs = readJsonPref('kula_graphs_max', {});
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

export function getChartMaxBound(id) {
    let pref = graphMaxPrefs()[id];
    if (!pref && state.configMax) pref = state.configMax[id];
    if (!pref || !pref.mode || pref.mode === 'off') return undefined;
    if (pref.mode === 'on') return pref.value;
    if (pref.mode === 'auto') {
        if (typeof pref.auto === 'number' && pref.auto > 0) return pref.auto; // TjMax or Link Speed
        return pref.value; // Fallback bound
    }
    return undefined;
}

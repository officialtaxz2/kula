/* ============================================================
   charts-init.js — Chart.js instance creation and full
   dashboard chart initialization.
   ============================================================ */
'use strict';
import { state, colors, getChartMaxBound, seriesColor } from './state.js';
import {
    formatBytesShort,
    formatChartTick,
    formatFullTimestamp,
    formatMbps,
    formatMetricNumber,
    formatPPS,
    historyTooltipLines,
} from './format.js';
import { i18n } from './i18n.js';
import { getSetting } from './settings.js';
import { registerChart, forEachRegisteredChart, queueChartUpdate } from './chart-controller.js';
import {
    attachChartGestures,
    attachCrosshairEvents,
    attachTooltipGestures,
    crosshairPlugin,
    sharedCrosshair,
    tooltipGesturePlugin,
} from './chart-interactions.js';
import { attachChartAccessibility, chartAccessibilityPlugin } from './chart-accessibility.js';
import { envelopePlugin } from './chart-envelope.js';
import { minimumZoomSpan } from './history-navigation.js';

Chart.register(envelopePlugin, chartAccessibilityPlugin, crosshairPlugin, tooltipGesturePlugin);

// ---- Chart Initialization ----
// Network ticks share one unit and one precision per axis ("0, 2.5, 5 Mbps"),
// so a step of 0.5 does not print "3.50 Mbps" beside "3 Mbps".
function mbpsTick(value, _index, ticks) {
    const values = ticks.map(tick => tick.value);
    if (Math.max(...values) < 1) return formatMbps(value);
    const digits = [0, 1, 2].find(d => values.every(v => Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6)) ?? 2;
    return `${value.toFixed(digits)} Mbps`;
}

// Replaces Chart.js's decimal ticks on a byte axis with steps of 1, 2, 4 or
// 5 times a power of 1024 (or 128/256/512 of the unit below), about five per axis.
function binaryByteTicks(axis) {
    const span = axis.max - axis.min;
    if (!(span >= 8)) return;
    const unit = 1024 ** Math.floor(Math.log(span) / Math.log(1024));
    const raw = span / unit / 5;
    const nice = [0.125, 0.25, 0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100, 128, 256, 512].find(n => n >= raw) || 1024;
    const step = nice * unit;
    const ticks = [];
    for (let value = Math.ceil(axis.min / step) * step; value <= axis.max + step * 1e-6; value += step) {
        ticks.push({ value });
    }
    if (ticks.length >= 2) axis.ticks = ticks;
}

export function createTimeSeriesChart(canvasId, datasets, yConfig = {}, extraPlugins = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // Filled-to-zero areas obscure neighboring series and smooth curves imply
    // observations that never occurred. Historical variability is rendered by
    // the explicit Min/Max envelope plugin instead.
    datasets.forEach(dataset => {
        dataset.fill = false;
        dataset.tension = 0;
    });

    if (canvasId === 'chart-cpu' && datasets.length) datasets[datasets.length - 1].kulaPrincipal = true;

    const tooltipExtras = extraPlugins.tooltip || {};
    const tooltipCallbacks = tooltipExtras.callbacks || {};
    const tooltipTimestamp = items => Number(items?.[0]?.parsed?.x ?? items?.[0]?.raw?.x);

    const chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            normalized: true,
            parsing: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            spanGaps: state.joinMetrics,
            plugins: {
                kulaEnvelope: {
                    allSeries: getSetting('all_series_envelopes'),
                    gaps: () => state.historyGaps,
                    gapColor: 'rgba(148, 163, 184, 0.12)',
                },
                legend: { position: 'top', align: 'end' },
                zoom: {
                    limits: {
                        x: { minRange: minimumZoomSpan(state.currentSourceResolution, state.collectionIntervalMs) },
                    },
                    pan: {
                        // chartjs-plugin-zoom delegates pan/pinch to Hammer.js.
                        // Kula uses Pointer Events instead (see chart-interactions.js),
                        // so this must stay disabled to avoid duplicate gestures.
                        enabled: false,
                        mode: 'x',
                        onPanStart: function({ chart }) {
                            if (state.focusSelecting) return false;
                            state.pausedZoom = true;
                            document.dispatchEvent(new Event('kula-sync-pause'));
                        },
                        onPan: function({ chart }) { document.dispatchEvent(new CustomEvent('kula-zoom-sync', { detail: chart })); },
                        onPanComplete: function({ chart }) {
                            document.dispatchEvent(new CustomEvent('kula-zoom-sync', { detail: chart }));
                            document.dispatchEvent(new Event('kula-sync-pause'));
                        },
                    },
                    zoom: {
                        wheel: { enabled: true, modifierKey: 'ctrl', speed: 0.1 },
                        pinch: { enabled: false },
                        drag: { enabled: true, backgroundColor: 'rgba(59,130,246,0.1)', borderColor: colors.blue, borderWidth: 1 },
                        mode: 'x',
                        onZoomStart: function({ chart, event }) {
                            if (state.focusSelecting) return false;
                            // Shift+drag belongs to the Pointer Events pan layer.
                            if (event?.shiftKey) return false;
                            state.pausedZoom = true;
                            document.dispatchEvent(new Event('kula-sync-pause'));
                        },
                        onZoom: function({ chart }) {
                            document.dispatchEvent(new CustomEvent('kula-zoom-sync', {
                                detail: { chart, complete: false },
                            }));
                        },
                        onZoomComplete: function({ chart }) {
                            document.dispatchEvent(new CustomEvent('kula-zoom-sync', {
                                detail: { chart, complete: true },
                            }));
                            document.dispatchEvent(new Event('kula-sync-pause'));
                        },
                    },
                },
                tooltip: {
                    position: 'awayFromCursor',
                    xAlign: 'left',
                    yAlign: 'top',
                    caretSize: 0,
                    ...tooltipExtras,
                    callbacks: {
                        label: context => {
                            const label = context.dataset?.label;
                            const value = formatMetricNumber(context.parsed?.y);
                            return label ? `${label}: ${value}` : value;
                        },
                        ...tooltipCallbacks,
                        title: items => formatFullTimestamp(
                            tooltipTimestamp(items),
                            state.timeZone,
                            i18n.currentLang,
                        ),
                        footer: items => {
                            if (!getSetting('chart_tooltip_details')) return [];
                            const timestamp = tooltipTimestamp(items);
                            return [
                                ...historyTooltipLines(state.historyPointContexts.get(timestamp), {
                                    mode: state.timeZone,
                                    locale: i18n.currentLang,
                                    aggregation: state.currentAggregation,
                                    extremaSources: items.map(item => item.raw?.extremaSource).filter(Boolean),
                                    translate: key => i18n.t(key),
                                }),
                            ];
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'time',
                    time: { 
                        tooltipFormat: 'MMM d, HH:mm:ss', 
                        displayFormats: { 
                            second: 'HH:mm:ss', 
                            minute: 'HH:mm', 
                            hour: 'HH:mm',
                            day: 'MMM d'
                        } 
                    },
                    grid: { display: false },
                    ticks: {
                        autoSkip: true,
                        autoSkipPadding: 24,
                        maxTicksLimit: 8,
                        sampleSize: 8,
                        minRotation: 0,
                        maxRotation: 0,
                        callback: function(value) {
                            return formatChartTick(value, state.timeZone, this?._unit, i18n.currentLang);
                        },
                    },
                },
                y: {
                    beginAtZero: true,
                    ...yConfig,
                    grid: { color: 'rgba(55, 65, 81, 0.2)' },
                },
            },
            elements: {
                point: { radius: 0, hoverRadius: 3 },
                line: { tension: 0, borderWidth: 1.5 },
            },
        },
    });

    // Keep callbacks out of custom-plugin options: Chart.js may resolve an
    // arbitrary option function as a scriptable value before the plugin sees
    // it. Chart-local state remains a function and follows language changes.
    chart.$kulaHistoryStatus = state.historyStatus;
    const detachAccessibility = attachChartAccessibility(chart, {
        translate: key => i18n.t(key),
        formatTimestamp: value => formatFullTimestamp(value, state.timeZone, i18n.currentLang),
        formatNumber: formatMetricNumber,
        getPinnedTimestamp: () => sharedCrosshair.pinned,
        getDataControlsEnabled: () => getSetting('chart_data_controls'),
    });
    const detachGestures = attachChartGestures(chart);
    const detachTooltip = attachTooltipGestures(chart);
    const detachCrosshair = attachCrosshairEvents(chart);
    return registerChart(chart, () => {
        detachAccessibility();
        detachGestures();
        detachTooltip();
        detachCrosshair();
    });
}

export function destroyAllCharts() {
    Object.keys(state.charts).forEach(key => {
        if (state.charts[key]) {
            state.charts[key].destroy();
            state.charts[key] = null;
        }
    });
    // Destroy dynamic app charts and remove their DOM elements
    destroyAppCharts();
}

// destroyAppCharts cleans up all dynamically created application chart
// instances and their associated DOM elements from the applications grid.
export function destroyAppCharts() {
    // Container metric charts use stable card ids (card-containers-cpu, …).
    const containerCardIds = [
        'card-containers-cpu', 'card-containers-mem',
        'card-containers-net-rx', 'card-containers-net-tx',
        'card-containers-disk-r', 'card-containers-disk-w',
        // legacy combined I/O cards (pre-split)
        'card-containers-net', 'card-containers-diskio',
    ];
    Object.entries(state.containerCharts || {}).forEach(([key, chart]) => {
        if (chart) chart.destroy();
        // Prefer explicit card ids; fall back to legacy card-${key} for safety.
        document.getElementById(`card-containers-${key}`)?.remove();
        document.getElementById(`card-${key}`)?.remove();
    });
    containerCardIds.forEach(id => document.getElementById(id)?.remove());
    state.containerCharts = {};
    // Keep containerApps / containerExcluded so colors and selection survive a
    // chart rebuild (e.g. after changing aggregation or y-axis prefs).

    Object.entries(state.customCharts || {}).forEach(([group, entry]) => {
        if (entry?.chart) entry.chart.destroy();
        document.getElementById(`card-custom-${group}`)?.remove();
    });
    state.customCharts = {};

    Object.entries(state.psuCharts || {}).forEach(([key, chart]) => {
        if (chart) chart.destroy();
        document.getElementById(`card-${key}`)?.remove();
    });
    state.psuCharts = {};

    // Remove dynamically created nginx/apache2/postgres/mysql cards
    ['card-nginx-connections', 'card-nginx-requests', 'card-nginx-rw',
     'card-apache2-workers', 'card-apache2-throughput', 'card-apache2-states',
     'card-pg-connections', 'card-pg-tps', 'card-pg-locks',
     'card-pg-tuples', 'card-pg-io', 'card-pg-cache-hit',
     'card-pg-table-health', 'card-pg-bgwriter', 'card-pg-replication',
     'card-mysql-connections', 'card-mysql-queries', 'card-mysql-slow',
     'card-mysql-innodb', 'card-mysql-locks', 'card-mysql-replication'].forEach(id => {
        document.getElementById(id)?.remove();
    });
}

export function initCharts() {
    destroyAllCharts();

    // Series take their colour from a role (see seriesPalette in state.js) so
    // the same hue keeps the same meaning across charts. Each chart shows at
    // most three series by default; the rest start hidden behind the legend.
    const series = (labelKey, role, extra = {}) => ({
        label: i18n.t(labelKey), kulaRole: role, borderColor: seriesColor(role), data: [], fill: false, ...extra,
    });
    const hidden = { hidden: true };
    const dashed = { borderDash: [4, 2] };
    const unit = (format) => ({ tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + format(ctx.parsed.y) } } });
    const percent = v => formatMetricNumber(v) + '%';
    const whole = v => formatMetricNumber(Math.round(v));
    // Integer steps keep near-zero ranges from repeating "0 B, 0 B, 0 B".
    const countTicks = { precision: 0 };
    // Byte axes step in binary units (4 GB, 512 MB …) to match the binary
    // labels; decimal steps printed "1.9 GB, 3.7 GB, 5.6 GB".
    const byteAxis = (suffix = '') => ({
        afterBuildTicks: binaryByteTicks,
        ticks: { ...countTicks, callback: v => formatBytesShort(v).replace('.0 ', ' ') + suffix },
    });

    // CPU — total plus the parts that explain a busy CPU
    state.charts.cpu = createTimeSeriesChart('chart-cpu', [
        series('user', 'c4'),
        series('system', 'c2'),
        series('iowait', 'c3'),
        series('steal', 'c5', hidden),
        series('total', 'c1', { borderWidth: 2 }),
    ], { max: 100, ticks: { callback: percent } }, unit(percent));

    state.cpuTempSensorNames = [];
    let cpuTempYConfig = { ticks: { callback: v => v.toFixed(1) + '°C' } };
    let cpuTempMax = getChartMaxBound('cpu_temp');
    if (cpuTempMax !== undefined) cpuTempYConfig.max = cpuTempMax;

    state.charts.cputemp = createTimeSeriesChart('chart-cpu-temp', [
        series('temperature', 'c2'),
    ], cpuTempYConfig, unit(v => v.toFixed(1) + '°C'));

    // Load Average — the 1-minute value leads, the slower averages give context
    state.charts.loadavg = createTimeSeriesChart('chart-loadavg', [
        series('1_min', 'c1', { borderWidth: 2 }),
        series('5_min', 'muted'),
        series('15_min', 'muted', dashed),
    ]);

    // Memory — with Free, Available, and Shmem datasets, max set dynamically
    state.charts.memory = createTimeSeriesChart('chart-memory', [
        series('used', 'c1'),
        series('buffers', 'c4', hidden),
        series('cached', 'c3'),
        series('shmem', 'c5', hidden),
        series('free', 'muted', { ...dashed, ...hidden }),
        series('available', 'muted', dashed),
    ], byteAxis(), unit(formatBytesShort));

    // Swap — with Free dataset, max set dynamically
    state.charts.swap = createTimeSeriesChart('chart-swap', [
        series('used', 'c1'),
        series('free', 'muted', { ...dashed, ...hidden }),
    ], { min: 0, ...byteAxis() }, unit(formatBytesShort));

    // A floor of 10 Kbps keeps an idle link from labelling every tick "0 Kbps".
    let networkYConfig = { suggestedMax: 0.01, ticks: { callback: mbpsTick } };
    let networkMax = getChartMaxBound('network');
    if (networkMax !== undefined) networkYConfig.max = networkMax;

    state.charts.network = createTimeSeriesChart('chart-network', [
        series('rx', 'c1'),
        series('tx', 'c2'),
    ], networkYConfig, unit(formatMbps));

    state.charts.pps = createTimeSeriesChart('chart-pps', [
        series('rx_pps', 'c1'),
        series('tx_pps', 'c2'),
    ], { ticks: { ...countTicks, callback: v => formatPPS(v) } }, unit(v => formatPPS(Math.round(v))));

    // Connections — open and closing sockets; protocol totals and error rates
    // (also in the subtitle) are a legend click away.
    state.charts.connections = createTimeSeriesChart('chart-connections', [
        series('tcp', 'c4', hidden),
        series('udp', 'c3', hidden),
        series('time_wait', 'c2'),
        series('established', 'c1'),
        series('inerrs', 'c7', { ...dashed, ...hidden }),
        series('outrsts', 'c6', { ...dashed, ...hidden }),
        series('retrans', 'c5', { ...dashed, ...hidden }),
    ], { ticks: countTicks }, unit(whole));

    // Disk I/O — throughput by default; the operation rates bring their own
    // axis only while one of them is shown.
    state.charts.diskio = createTimeSeriesChart('chart-disk-io', [
        series('read_bs', 'c1', { yAxisID: 'y' }),
        series('write_bs', 'c2', { yAxisID: 'y' }),
        series('reads_s', 'c1', { ...dashed, ...hidden, yAxisID: 'y1' }),
        series('writes_s', 'c2', { ...dashed, ...hidden, yAxisID: 'y1' }),
    ], byteAxis('/s'), {
        tooltip: {
            callbacks: {
                label: ctx => ctx.dataset.yAxisID === 'y1'
                    ? ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(0) + ' IOPS'
                    : ctx.dataset.label + ': ' + formatBytesShort(Math.round(ctx.parsed.y)) + '/s'
            }
        }
    });

    // Reconfigure disk IO chart for dual axes
    if (state.charts.diskio) {
        state.charts.diskio.options.scales.y1 = {
            display: 'auto',
            position: 'right',
            beginAtZero: true,
            grid: { display: false },
            ticks: { ...countTicks, callback: v => v.toFixed(0) + ' IO/s' },
        };
        queueChartUpdate(state.charts.diskio);
    }

    state.diskTempSensorNames = [];
    let diskTempYConfig = { ticks: { callback: v => v.toFixed(1) + '°C' } };
    let diskTempMax = getChartMaxBound('disk_temp');
    if (diskTempMax !== undefined) diskTempYConfig.max = diskTempMax;

    state.charts.disktemp = createTimeSeriesChart('chart-disk-temp', [
        series('temperature', 'c2'),
    ], diskTempYConfig, unit(v => v.toFixed(1) + '°C'));

    // Disk Space — datasets are added dynamically per mount on first sample
    state.diskSpaceMountNames = [];
    state.charts.diskspace = createTimeSeriesChart('chart-disk-space', [],
        { max: 100, ticks: { callback: v => Math.round(v) + '%' } }, {
        tooltip: {
            callbacks: {
                label: ctx => {
                    const raw = ctx.raw;
                    if (raw && raw.used !== undefined && raw.total !== undefined) {
                        return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% (${formatBytesShort(raw.used)} / ${formatBytesShort(raw.total)})`;
                    }
                    return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + '%';
                }
            }
        }
    });

    // Processes — how many run or wait, against the total
    state.charts.processes = createTimeSeriesChart('chart-processes', [
        series('running', 'c1'),
        series('sleeping', 'c4', hidden),
        series('blocked', 'c2'),
        series('zombie', 'c7', hidden),
        series('total', 'muted', dashed),
    ], { ticks: countTicks }, unit(whole));

    // Entropy
    state.charts.entropy = createTimeSeriesChart('chart-entropy', [
        series('entropy', 'c1'),
    ], { ticks: countTicks }, unit(whole));

    // GPU Load
    state.charts.gpuload = createTimeSeriesChart('chart-gpu-load', [
        series('load_pct', 'c1'),
        series('power_w', 'c2', { ...hidden, yAxisID: 'y1' }),
    ], { max: 100, ticks: { callback: percent } }, {
        tooltip: {
            callbacks: {
                label: ctx => ctx.dataset.label + ': ' + (ctx.dataset.yAxisID === 'y1'
                    ? ctx.parsed.y.toFixed(1) + ' W'
                    : percent(ctx.parsed.y)),
            },
        },
    });
    if (state.charts.gpuload) {
        state.charts.gpuload.options.scales.y1 = {
            display: 'auto',
            position: 'right',
            beginAtZero: true,
            grid: { display: false },
            ticks: { callback: v => v.toFixed(1) + ' W' },
        };
        queueChartUpdate(state.charts.gpuload);
    }

    // VRAM
    state.charts.vram = createTimeSeriesChart('chart-vram', [
        series('used', 'c1'),
    ], byteAxis(), unit(formatBytesShort));

    // GPU Temperature
    let gpuTempMax = getChartMaxBound('gpu_temp');
    let gpuTempYConfig = { max: gpuTempMax, ticks: { callback: v => v.toFixed(1) + '°C' } };
    state.charts.gputemp = createTimeSeriesChart('chart-gpu-temp', [
        series('temperature', 'c2'),
    ], gpuTempYConfig, unit(v => v.toFixed(1) + '°C'));

    // Self monitoring — Kula's own CPU share; memory has its own axis when shown
    state.charts.self = createTimeSeriesChart('chart-self', [
        series('cpu_pct', 'c1', { yAxisID: 'y' }),
        series('rss', 'c4', { ...hidden, yAxisID: 'y1' }),
    ], { ticks: { callback: percent } }, {
        tooltip: {
            callbacks: {
                label: ctx => ctx.dataset.yAxisID === 'y1'
                    ? ctx.dataset.label + ': ' + formatBytesShort(ctx.parsed.y)
                    : ctx.dataset.label + ': ' + percent(ctx.parsed.y)
            }
        }
    });
    // Reconfigure self chart for dual axes
    if (state.charts.self) {
        state.charts.self.options.scales.y1 = {
            display: 'auto',
            position: 'right',
            beginAtZero: true,
            grid: { display: false },
            ticks: { ...countTicks, callback: v => formatBytesShort(v) },
        };
        queueChartUpdate(state.charts.self);
    }

    // Applications — nginx, containers, postgres, custom charts are all
    // created dynamically in charts-data.js on first data arrival.
}

// ---- Set x-axis bounds for full time window ----
export function setChartTimeRange() {
    const now = state.historyViewEnd ?? Date.now();
    let xMin, xMax;

    if (state.timeRange !== null) {
        xMin = now - state.timeRange * 1000;
        xMax = now;
    } else if (state.customFrom && state.customTo) {
        xMin = state.customFrom.getTime();
        xMax = state.customTo.getTime();
    } else {
        return;
    }

    const windowSec = (xMax - xMin) / 1000;
    const minUnit = windowSec >= 259200 ? 'day' : false;

    const applyToChart = (chart) => {
        if (!chart?.options?.scales?.x || chart.config?.type === 'bar') return;
        chart.options.scales.x.min = xMin;
        chart.options.scales.x.max = xMax;
        if (minUnit) {
            chart.options.scales.x.time.minUnit = minUnit;
        } else {
            delete chart.options.scales.x.time.minUnit;
        }
    };

    forEachRegisteredChart(applyToChart);
}

export function updateChartLabels() {
    if (!state.charts) return;

    if (state.charts.cpu) {
        state.charts.cpu.data.datasets[0].label = i18n.t('user');
        state.charts.cpu.data.datasets[1].label = i18n.t('system');
        state.charts.cpu.data.datasets[2].label = i18n.t('iowait');
        state.charts.cpu.data.datasets[3].label = i18n.t('steal');
        state.charts.cpu.data.datasets[4].label = i18n.t('total');
    }

    if (state.charts.cputemp?.data.datasets[0] && state.cpuTempSensorNames.length === 0) {
        state.charts.cputemp.data.datasets[0].label = i18n.t('temperature');
    }

    if (state.charts.loadavg) {
        state.charts.loadavg.data.datasets[0].label = i18n.t('1_min');
        state.charts.loadavg.data.datasets[1].label = i18n.t('5_min');
        state.charts.loadavg.data.datasets[2].label = i18n.t('15_min');
    }

    if (state.charts.memory) {
        state.charts.memory.data.datasets[0].label = i18n.t('used');
        state.charts.memory.data.datasets[1].label = i18n.t('buffers');
        state.charts.memory.data.datasets[2].label = i18n.t('cached');
        state.charts.memory.data.datasets[3].label = i18n.t('shmem');
        state.charts.memory.data.datasets[4].label = i18n.t('free');
        state.charts.memory.data.datasets[5].label = i18n.t('available');
    }

    if (state.charts.swap) {
        state.charts.swap.data.datasets[0].label = i18n.t('used');
        state.charts.swap.data.datasets[1].label = i18n.t('free');
    }

    if (state.charts.network) {
        state.charts.network.data.datasets[0].label = i18n.t('rx');
        state.charts.network.data.datasets[1].label = i18n.t('tx');
    }

    if (state.charts.pps) {
        state.charts.pps.data.datasets[0].label = i18n.t('rx_pps');
        state.charts.pps.data.datasets[1].label = i18n.t('tx_pps');
    }

    if (state.charts.connections) {
        state.charts.connections.data.datasets[0].label = i18n.t('tcp');
        state.charts.connections.data.datasets[1].label = i18n.t('udp');
        state.charts.connections.data.datasets[2].label = i18n.t('time_wait');
        state.charts.connections.data.datasets[3].label = i18n.t('established');
        state.charts.connections.data.datasets[4].label = i18n.t('inerrs');
        state.charts.connections.data.datasets[5].label = i18n.t('outrsts');
        state.charts.connections.data.datasets[6].label = i18n.t('retrans');
    }

    if (state.charts.diskio) {
        state.charts.diskio.data.datasets[0].label = i18n.t('read_bs');
        state.charts.diskio.data.datasets[1].label = i18n.t('write_bs');
        state.charts.diskio.data.datasets[2].label = i18n.t('reads_s');
        state.charts.diskio.data.datasets[3].label = i18n.t('writes_s');
    }

    if (state.charts.disktemp?.data.datasets[0] && state.diskTempSensorNames.length === 0) {
        state.charts.disktemp.data.datasets[0].label = i18n.t('temperature');
    }

    if (state.charts.processes) {
        state.charts.processes.data.datasets[0].label = i18n.t('running');
        state.charts.processes.data.datasets[1].label = i18n.t('sleeping');
        state.charts.processes.data.datasets[2].label = i18n.t('blocked');
        state.charts.processes.data.datasets[3].label = i18n.t('zombie');
        state.charts.processes.data.datasets[4].label = i18n.t('total');
    }

    if (state.charts.entropy) {
        state.charts.entropy.data.datasets[0].label = i18n.t('entropy');
    }

    if (state.charts.gpuload) {
        state.charts.gpuload.data.datasets[0].label = i18n.t('load_pct');
        state.charts.gpuload.data.datasets[1].label = i18n.t('power_w');
    }

    if (state.charts.vram) {
        state.charts.vram.data.datasets[0].label = i18n.t('used');
    }

    if (state.charts.gputemp) {
        state.charts.gputemp.data.datasets[0].label = i18n.t('temperature');
    }

    if (state.charts.self) {
        state.charts.self.data.datasets[0].label = i18n.t('cpu_pct');
        state.charts.self.data.datasets[1].label = i18n.t('rss');
    }
}

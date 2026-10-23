/* ============================================================
   header-menus.js — The header's "More" menu and the command menu
   that shares the chart search field.
   ============================================================ */
'use strict';
import { i18n } from './i18n.js';

const el = id => document.getElementById(id);

// ---- More menu ----
// A menu button with roving focus: arrows move between items, Escape and Tab
// close it, and an activated item closes it before its own handler runs on.
export function initMoreMenu() {
    const btn = el('btn-more');
    const menu = el('more-menu');
    if (!btn || !menu) return;

    const items = () => Array.from(menu.querySelectorAll('.more-item')).filter(item => !item.classList.contains('hidden'));
    const isOpen = () => !menu.classList.contains('hidden');
    const close = ({ focus = false } = {}) => {
        if (!isOpen()) return;
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (focus) btn.focus();
    };
    const open = ({ focusLast = false } = {}) => {
        menu.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        const list = items();
        list[focusLast ? list.length - 1 : 0]?.focus();
    };

    btn.addEventListener('click', event => {
        event.stopPropagation();
        if (isOpen()) close();
        else open();
    });
    btn.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open({ focusLast: event.key === 'ArrowUp' });
        }
    });
    menu.addEventListener('keydown', event => {
        const list = items();
        const at = list.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'ArrowDown') next = list[(at + 1) % list.length];
        else if (event.key === 'ArrowUp') next = list[(at - 1 + list.length) % list.length];
        else if (event.key === 'Home') next = list[0];
        else if (event.key === 'End') next = list[list.length - 1];
        else if (event.key === 'Escape') {
            event.preventDefault();
            close({ focus: true });
            return;
        } else if (event.key === 'Tab') {
            close();
            return;
        }
        if (next) {
            event.preventDefault();
            next.focus();
        }
    });
    // Close first so a handler that moves focus (System Info) keeps it.
    menu.addEventListener('click', event => {
        if (event.target.closest('.more-item')) close();
    }, true);
    document.addEventListener('click', event => {
        if (!event.target.closest('#more-container')) close();
    });
}

// ---- Command menu ----
// The chart search keeps filtering the grid as before; the list below it adds
// jumps to a chart, the time presets and the header actions. Ctrl/Cmd+K or "/"
// opens it from anywhere outside a text field.
const ACTION_IDS = ['btn-live', 'btn-pause', 'btn-alerts', 'btn-info', 'btn-focus', 'btn-layout',
    'btn-theme', 'btn-settings', 'btn-ai'];
const MAX_IDLE_CHARTS = 6;

function actionLabel(button) {
    return (button.querySelector('.more-item span, [data-i18n]')?.textContent
        || button.getAttribute('aria-label') || button.title || '').trim();
}

function chartEntries() {
    return Array.from(document.querySelectorAll('.chart-card'))
        .filter(card => card.id && !card.classList.contains('hidden') && !card.closest('.hidden'))
        .map(card => {
            const title = card.querySelector('h3')?.textContent.trim() || '';
            // Titles and series names only: the subtitles hold live values, and
            // typing "5" should find the 5 minute preset rather than every card.
            const terms = `${title} ${card.dataset.searchTerms || ''}`;
            return { group: 'charts', label: title, terms, run: () => revealCard(card) };
        })
        .filter(entry => entry.label);
}

function timeEntries() {
    const entries = Array.from(document.querySelectorAll('.time-btn[data-range]')).map(button => {
        const short = button.textContent.trim();
        const match = /^(\d+)([mhd])$/.exec(short);
        const label = match ? i18n.t(`last_${match[1]}_${match[2]}`) : short;
        return { group: 'command_time', label, hint: short, terms: `${label} ${short}`, run: () => button.click(),
            current: button.classList.contains('active'), focus: button, fallback: el('btn-time-menu') };
    });
    const custom = el('btn-custom-range');
    if (custom) {
        const label = actionLabel(custom);
        entries.push({ group: 'command_time', label, terms: label, run: () => custom.click(), focus: custom });
    }
    return entries;
}

function actionEntries() {
    return ACTION_IDS.map(el)
        .filter(button => button && !button.classList.contains('hidden') && !button.disabled
            && !(button.id === 'btn-live' && button.classList.contains('active')))
        .map(button => {
            const label = actionLabel(button);
            return { group: 'command_actions', label, terms: label, run: () => button.click(), focus: button };
        })
        .filter(entry => entry.label);
}

function revealCard(card) {
    const reduce = document.documentElement.classList.contains('a11y-reduce-motion')
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    card.classList.remove('command-target');
    void card.offsetWidth; // restart the highlight when the same card is picked twice
    card.classList.add('command-target');
    setTimeout(() => card.classList.remove('command-target'), 1600);
}

export function initCommandMenu({ filterCharts }) {
    const input = el('chart-search');
    const menu = el('command-menu');
    const wrap = el('command-search');
    if (!input || !menu || !wrap) return;

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const key = wrap.querySelector('.command-search-key');
    if (key) key.textContent = isMac ? '⌘K' : 'Ctrl K';

    let entries = [];
    let active = -1;

    const isOpen = () => !menu.classList.contains('hidden');
    const setActive = index => {
        const options = menu.querySelectorAll('[role="option"]');
        options.forEach((option, i) => {
            option.classList.toggle('active', i === index);
            option.setAttribute('aria-selected', String(i === index));
        });
        active = index;
        const current = options[index];
        if (current) {
            input.setAttribute('aria-activedescendant', current.id);
            current.scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    };
    const close = () => {
        menu.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        wrap.classList.remove('open');
        active = -1;
    };

    const render = () => {
        const query = input.value.trim().toLowerCase();
        const matches = entry => !query || entry.terms.toLowerCase().includes(query);
        let charts = chartEntries().filter(matches);
        if (!query) charts = charts.slice(0, MAX_IDLE_CHARTS);
        entries = [...charts, ...timeEntries().filter(matches), ...actionEntries().filter(matches)];

        menu.replaceChildren();
        let group = null;
        let groupNode = null;
        entries.forEach((entry, index) => {
            if (entry.group !== group) {
                group = entry.group;
                groupNode = document.createElement('div');
                groupNode.className = 'command-group';
                groupNode.setAttribute('role', 'group');
                const heading = document.createElement('div');
                heading.className = 'command-group-label';
                heading.setAttribute('role', 'presentation');
                heading.id = `command-group-${group}`;
                heading.textContent = i18n.t(group);
                groupNode.setAttribute('aria-labelledby', heading.id);
                groupNode.append(heading);
                menu.append(groupNode);
            }
            const option = document.createElement('div');
            option.className = 'command-item';
            option.id = `command-item-${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            if (entry.current) option.classList.add('current');
            const label = document.createElement('span');
            label.className = 'command-item-label';
            label.textContent = entry.label;
            option.append(label);
            if (entry.hint) {
                const hint = document.createElement('span');
                hint.className = 'command-item-hint';
                hint.textContent = entry.hint;
                option.append(hint);
            }
            // Keep the focus in the field so typing can continue after a click.
            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('mousemove', () => { if (active !== index) setActive(index); });
            option.addEventListener('click', event => {
                event.stopPropagation();
                run(index);
            });
            groupNode.append(option);
        });
        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'command-empty';
            empty.setAttribute('role', 'presentation');
            empty.textContent = i18n.t('command_no_matches');
            menu.append(empty);
        }
        menu.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
        wrap.classList.add('open');
        setActive(query && entries.length ? 0 : -1);
    };

    const run = index => {
        const entry = entries[index];
        if (!entry) return;
        close();
        input.value = '';
        filterCharts('');
        input.blur();
        entry.run();
        // Hand the focus to the control that was used when it is on screen,
        // or to the menu button that now holds it.
        const target = entry.focus;
        if (target && document.activeElement === document.body) {
            const holder = target.closest('#more-container') ? el('btn-more') : entry.fallback;
            (target.offsetParent ? target : holder)?.focus?.();
        }
    };

    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!isOpen()) render();
            if (!entries.length) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive(active < 0 ? (step > 0 ? 0 : entries.length - 1) : (active + step + entries.length) % entries.length);
        } else if (event.key === 'Enter') {
            if (active >= 0) {
                event.preventDefault();
                run(active);
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (isOpen()) {
                close();
            } else if (input.value) {
                input.value = '';
                filterCharts('');
            } else {
                input.blur();
            }
        }
    });

    document.addEventListener('keydown', event => {
        const target = event.target;
        const editing = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '');
        const shortcut = (event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey) && !event.altKey;
        if (!shortcut && !(event.key === '/' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey)) return;
        // Hidden with the search field in focus mode and on the System Info page.
        if (!wrap.offsetParent) return;
        event.preventDefault();
        input.focus();
        input.select();
    });
}

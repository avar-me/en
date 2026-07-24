/**
 * Phrase search (en.avar.me/phrases.html)
 * Full-text search over examples and sense text of both dictionaries (av-en, en-av).
 */

const CONFIG = {
    MIN_QUERY_LEN: 2,
    DEBOUNCE_DELAY: 200,
    MAX_RESULTS: 200,
};

/** Substituted at build time (phrases.html); busts Cloudflare cache for data/*. */
const ASSET_VERSION = (typeof window !== 'undefined' && window.__DICT_ASSET_V__) || '';

function assetUrl(path) {
    if (!ASSET_VERSION) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}v=${encodeURIComponent(ASSET_VERSION)}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** Consistent with normalizeWord() in app.js and normalize_word() in build_data.py. */
function normalizeQuery(word) {
    return word.toLowerCase().trim().replace(/[1IiｌlL|!ǀӀІ]/g, 'ӏ').replace(/ё/g, 'е');
}

/**
 * No .trim() — keeps a 1:1 mapping between character indices and the
 * original phrase text, needed for match highlighting (highlightMatch).
 * ё->е is also 1:1 in length, so indices don't shift.
 */
function normalizeText(s) {
    return s.toLowerCase().replace(/[1IiｌlL|!ǀӀІ]/g, 'ӏ').replace(/ё/g, 'е');
}

function highlightMatch(original, normalized, queryNorm) {
    if (!queryNorm) return escapeHtml(original);
    const idx = normalized.indexOf(queryNorm);
    if (idx === -1) return escapeHtml(original);
    const before = original.slice(0, idx);
    const match = original.slice(idx, idx + queryNorm.length);
    const after = original.slice(idx + queryNorm.length);
    return `${escapeHtml(before)}<mark class="phrase-hl">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function debounce(func, delay) {
    let timeoutId;
    const debounced = function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
    debounced.cancel = () => clearTimeout(timeoutId);
    return debounced;
}

const state = {
    avEn: null,
    enAv: null,
};

/**
 * Download all phrase chunks for a dictionary and build a flat index with
 * precomputed normalized fields (for fast substring search).
 */
async function loadPhraseSet(dictName) {
    const manifestRes = await fetch(assetUrl(`data/phrases/${dictName}/manifest.json`));
    if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status}`);
    const manifest = await manifestRes.json();

    const chunkArrays = await Promise.all(
        manifest.chunks.map(async (c) => {
            const res = await fetch(assetUrl(`data/phrases/${dictName}/chunks/${c.file}`));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
    );

    const records = chunkArrays.flat();
    return records.map(([w, av, en, c]) => {
        const avNorm = normalizeText(av);
        const enNorm = normalizeText(en);
        return { w, av, en, c, avNorm, enNorm, combined: avNorm + '' + enNorm };
    });
}

/** Full scan over the index — size (tens of thousands of entries) makes caching partial slices unnecessary. */
function searchPhrases(index, queryNorm, limit) {
    const results = [];
    let total = 0;
    for (let i = 0; i < index.length; i++) {
        const item = index[i];
        if (item.combined.indexOf(queryNorm) !== -1) {
            total++;
            if (results.length < limit) results.push(item);
        }
    }
    return { results, total };
}

function wordLink(word, dict) {
    return `index.html#dict=${encodeURIComponent(dict)}&word=${encodeURIComponent(word)}`;
}

function renderRows(items, dict, queryNorm, reversed) {
    if (!items.length) return '<p class="phrase-empty">No results found</p>';
    const rows = items
        .map((item) => {
            const avHtml = highlightMatch(item.av, item.avNorm, queryNorm);
            const enHtml = highlightMatch(item.en, item.enNorm, queryNorm);
            const leftHtml = reversed ? enHtml : avHtml;
            const rightHtml = reversed ? avHtml : enHtml;
            const commentHtml = item.c ? `<div class="phrase-comment">${escapeHtml(item.c)}</div>` : '';
            return `
                <div class="phrase-row">
                    <div class="phrase-cell phrase-cell-a">${leftHtml}</div>
                    <div class="phrase-cell phrase-cell-b">${rightHtml}</div>
                    <a class="phrase-link" href="${wordLink(item.w, dict)}" title="Open entry “${escapeHtml(item.w)}”">${escapeHtml(item.w)}</a>
                    ${commentHtml}
                </div>
            `;
        })
        .join('');
    return `<div class="phrase-list">${rows}</div>`;
}

function renderSection(containerId, index, dict, queryNorm, reversed, leftLabel, rightLabel) {
    const container = document.getElementById(containerId);
    if (!index) {
        container.innerHTML = '';
        return;
    }
    const { results, total } = searchPhrases(index, queryNorm, CONFIG.MAX_RESULTS);
    const caption =
        total > CONFIG.MAX_RESULTS
            ? `Found ${total} · showing first ${CONFIG.MAX_RESULTS}`
            : `Found ${total}`;
    const header = `
        <div class="phrase-header-row">
            <div>${escapeHtml(leftLabel)}</div>
            <div>${escapeHtml(rightLabel)}</div>
            <div>Word</div>
        </div>
    `;
    container.innerHTML = `<p class="phrase-table-caption">${caption}</p>${header}${renderRows(results, dict, queryNorm, reversed)}`;
}

function renderEmptyState() {
    document.getElementById('tableAvEn').innerHTML = '';
    document.getElementById('tableEnAv').innerHTML = '';
    document.getElementById('phraseStats').textContent = '';
}

/** #text=... in the URL — so a search result can be shared as a link. */
function updateHash(query) {
    const url = query
        ? `${window.location.pathname}${window.location.search}#text=${encodeURIComponent(query)}`
        : window.location.pathname + window.location.search;
    history.replaceState(null, '', url);
}

function runSearch(query) {
    const statsEl = document.getElementById('phraseStats');
    if (!query || query.length < CONFIG.MIN_QUERY_LEN) {
        renderEmptyState();
        if (query) statsEl.textContent = `Type ${CONFIG.MIN_QUERY_LEN - query.length} more character(s)`;
        return;
    }
    statsEl.textContent = '';
    const queryNorm = normalizeQuery(query);
    renderSection('tableAvEn', state.avEn, 'av-en', queryNorm, false, 'Avar', 'English');
    renderSection('tableEnAv', state.enAv, 'en-av', queryNorm, true, 'English', 'Avar');
}

const handleInput = debounce((query) => {
    updateHash(query);
    runSearch(query);
}, CONFIG.DEBOUNCE_DELAY);

function showLoading(show) {
    document.getElementById('phraseLoading').style.display = show ? 'flex' : 'none';
    document.getElementById('phraseResults').style.display = show ? 'none' : 'flex';
}

function showError(message) {
    const el = document.getElementById('phraseError');
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => {
        el.style.display = 'none';
    }, 5000);
}

function readHashQuery() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    return params.get('text') || '';
}

async function init() {
    const input = document.getElementById('phraseSearchInput');
    const clearBtn = document.getElementById('phraseClearBtn');

    showLoading(true);
    try {
        const [avEn, enAv] = await Promise.all([loadPhraseSet('av-en'), loadPhraseSet('en-av')]);
        state.avEn = avEn;
        state.enAv = enAv;
        console.log(`Phrases loaded: av-en=${avEn.length}, en-av=${enAv.length}`);
    } catch (error) {
        console.error('Error loading phrases:', error);
        showError('Failed to load phrase search data');
    }
    showLoading(false);

    input.addEventListener('input', (e) => {
        let value = e.target.value;
        const cursorPos = e.target.selectionStart;

        const normalizedValue = value.replace(/[1IiｌlL|!ǀӀІ]/g, 'ӏ');
        if (normalizedValue !== value) {
            e.target.value = normalizedValue;
            e.target.setSelectionRange(cursorPos, cursorPos);
            value = normalizedValue;
        }

        const query = value.trim();
        clearBtn.style.display = query ? 'block' : 'none';
        handleInput(query);
    });

    clearBtn.addEventListener('click', () => {
        handleInput.cancel();
        input.value = '';
        clearBtn.style.display = 'none';
        updateHash('');
        renderEmptyState();
        input.focus();
    });

    // Browser back/forward — while the field is focused the user is typing
    // and updates the hash themselves via updateHash(); don't interrupt that.
    window.addEventListener('hashchange', () => {
        if (document.activeElement === input) return;
        const query = readHashQuery();
        input.value = query;
        clearBtn.style.display = query ? 'block' : 'none';
        runSearch(query);
    });

    // #text=... in the link — show the result right away
    const initialQuery = readHashQuery();
    if (initialQuery) {
        input.value = initialQuery;
        clearBtn.style.display = 'block';
        runSearch(initialQuery);
    }

    input.focus();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

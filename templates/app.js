/**
 * English-Avar Dictionary App
 * en.avar.me
 */

(function() {
    'use strict';

    // State
    let dictionary = [];
    let selectedSuggestionIndex = -1;

    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const suggestionsEl = document.getElementById('suggestions');
    const resultsEl = document.getElementById('results');
    const randomSection = document.getElementById('random-section');
    const randomWordsEl = document.getElementById('random-words');
    const refreshBtn = document.getElementById('refresh-random');

    // Initialize
    async function init() {
        showLoading();
        
        try {
            const response = await fetch('dictionary.json');
            dictionary = await response.json();
            hideLoading();
            showRandomWords();
        } catch (error) {
            console.error('Failed to load dictionary:', error);
            showError('Failed to load dictionary. Please refresh the page.');
        }

        // Event listeners
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('keydown', handleKeyDown);
        searchInput.addEventListener('focus', handleSearchFocus);
        document.addEventListener('click', handleDocumentClick);
        refreshBtn.addEventListener('click', showRandomWords);
    }

    // Show loading state
    function showLoading() {
        randomWordsEl.innerHTML = '<div class="loading">Loading dictionary</div>';
    }

    // Hide loading state
    function hideLoading() {
        randomWordsEl.innerHTML = '';
    }

    // Show error message
    function showError(message) {
        randomWordsEl.innerHTML = `<div class="no-results"><div class="icon">⚠️</div>${message}</div>`;
    }

    // Handle search input
    function handleSearchInput(e) {
        const query = e.target.value.trim().toLowerCase();
        
        if (query.length === 0) {
            hideSuggestions();
            hideResults();
            showRandomSection();
            return;
        }

        hideRandomSection();
        const results = searchDictionary(query);
        showSuggestions(results.slice(0, 8), query);
        showResults(results, query);
    }

    // Handle keyboard navigation
    function handleKeyDown(e) {
        const items = suggestionsEl.querySelectorAll('.suggestion-item');
        
        if (!suggestionsEl.classList.contains('active') || items.length === 0) {
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
                updateSelectedSuggestion(items);
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
                updateSelectedSuggestion(items);
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedSuggestionIndex >= 0) {
                    const selectedWord = items[selectedSuggestionIndex].dataset.word;
                    searchInput.value = selectedWord;
                    handleSearchInput({ target: searchInput });
                    hideSuggestions();
                }
                break;
            case 'Escape':
                hideSuggestions();
                break;
        }
    }

    // Update selected suggestion highlight
    function updateSelectedSuggestion(items) {
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === selectedSuggestionIndex);
        });
        
        if (selectedSuggestionIndex >= 0) {
            items[selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // Handle search focus
    function handleSearchFocus() {
        const query = searchInput.value.trim().toLowerCase();
        if (query.length > 0) {
            const results = searchDictionary(query);
            showSuggestions(results.slice(0, 8), query);
        }
    }

    // Handle clicks outside suggestions
    function handleDocumentClick(e) {
        if (!searchInput.contains(e.target) && !suggestionsEl.contains(e.target)) {
            hideSuggestions();
        }
    }

    // Cyrillic to Latin transliteration mapping (avar.me scheme)
    const cyrToLatMap = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e',
        'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l',
        'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's',
        'т': 't', 'у': 'u', 'ф': 'f', 'х': 'x', 'ц': 'ž', 'ч': 'c',
        'ш': 'ş', 'щ': 'şç', 'ъ': "'", 'э': 'ê', 'ю': 'yu', 'я': 'ya',
        'ё': 'ö',
        // Multi-character sequences (must come before single chars)
        'гъ': 'gh', 'гь': 'ğ', 'гӀ': 'ġ',
        'кӀ': 'ķ', 'къ': 'q', 'кь': 'kļ',
        'лъ': 'ļ', 'лӀ': 'ł',
        'тӀ': 'ť',
        'хъ': 'kh', 'хь': 'h', 'хӀ': 'ħ',
        'цӀ': 'ź', 'чӀ': 'ć'
    };

    // Transliterate Cyrillic query to Latin
    function transliterateCyrillic(text) {
        if (!text) return '';
        
        let result = '';
        let i = 0;
        const textLower = text.toLowerCase();
        
        while (i < textLower.length) {
            let matched = false;
            
            // Check 2-character sequences first (longest match)
            if (i + 1 < textLower.length) {
                const twoChar = textLower.substring(i, i + 2);
                if (cyrToLatMap[twoChar]) {
                    result += cyrToLatMap[twoChar];
                    i += 2;
                    matched = true;
                }
            }
            
            // Check single character
            if (!matched) {
                const char = textLower[i];
                if (cyrToLatMap[char]) {
                    result += cyrToLatMap[char];
                } else if (char === '1' || char === '!') {
                    // Palochka variants - these are handled in normalization
                    // For now, just skip them (they'll be removed in normalization)
                    // This allows "т1" to become "t" which will match "ť" after normalization
                } else {
                    // Character not in map, keep as-is
                    result += char;
                }
                i++;
            }
        }
        
        return result;
    }

    // Character mapping table: basic Latin -> Avar variants (avar.me scheme)
    const charMap = {
        'a': ['a'],
        'b': ['b'],
        'c': ['c', 'ć', 'ž', 'ź'],  // ч, чӀ, ц, цӀ
        'd': ['d'],
        'e': ['e', 'ê'],  // е, э
        'f': ['f'],
        'g': ['g', 'gh', 'ğ', 'ġ'],  // г, гъ, гь, гӀ
        'h': ['h', 'ħ', 'kh'],  // гь, хӀ, хъ
        'i': ['i'],
        'j': ['j'],
        'k': ['k', 'ķ', 'q', 'kļ'],  // к, кӀ, къ, кь
        'l': ['l', 'ļ', 'ł'],  // л, лъ, лӀ
        'm': ['m'],
        'n': ['n'],
        'o': ['o', 'ö'],  // о, ё
        'p': ['p'],
        'q': ['q', 'kh'],  // къ, хъ
        'r': ['r'],
        's': ['s', 'ş', 'şç'],  // с, ш, щ
        't': ['t', 'ť'],  // т, тӀ
        'u': ['u'],
        'v': ['v'],
        'x': ['x', 'kh', 'h'],  // х, хъ, хь
        'y': ['y'],
        'z': ['z', 'ž', 'ź'],  // з, ц, цӀ
        // Multi-character sequences
        'gh': ['gh', 'ğ', 'ġ'],  // гъ, гь, гӀ
        'kh': ['kh', 'q', 'h'],  // хъ, хъ, хь
        'sh': ['ş', 'şç'],  // ш, щ
        'ch': ['c', 'ć'],  // ч, чӀ
        'yu': ['yu'],
        'ya': ['ya']
    };

    // Expand query to include all Avar character variants
    function expandAvarQuery(query) {
        const queryLower = query.toLowerCase();
        
        // Build regex pattern that matches any variant of each character
        let pattern = '';
        let i = 0;
        
        while (i < queryLower.length) {
            // Check for multi-character sequences first (longest match)
            let matched = false;
            
            // Check 2-character sequences (like "gh", "kh", "sh", etc.)
            if (i + 1 < queryLower.length) {
                const twoChar = queryLower.substring(i, i + 2);
                if (charMap[twoChar]) {
                    const variants = charMap[twoChar];
                    // For multi-char sequences, use alternation
                    if (variants.length > 1) {
                        pattern += `(${variants.map(v => escapeRegex(v)).join('|')})`;
                    } else {
                        pattern += escapeRegex(variants[0]);
                    }
                    i += 2;
                    matched = true;
                }
            }
            
            // Check single character
            if (!matched) {
                const char = queryLower[i];
                if (charMap[char]) {
                    const variants = charMap[char];
                    // Filter out multi-character variants for single char mapping
                    const singleCharVariants = variants.filter(v => v.length === 1);
                    const multiCharVariants = variants.filter(v => v.length > 1);
                    
                    if (singleCharVariants.length > 0) {
                        if (singleCharVariants.length > 1) {
                            // Use character class for multiple single-char variants
                            pattern += `[${singleCharVariants.map(v => escapeRegex(v)).join('')}]`;
                        } else {
                            pattern += escapeRegex(singleCharVariants[0]);
                        }
                    }
                    
                    // Add multi-char variants as alternation if any
                    if (multiCharVariants.length > 0) {
                        if (singleCharVariants.length > 0) {
                            // Combine single and multi-char variants
                            const allVariants = [...singleCharVariants, ...multiCharVariants];
                            pattern = pattern.slice(0, -1); // Remove last char (single variant)
                            pattern += `(${allVariants.map(v => escapeRegex(v)).join('|')})`;
                        } else {
                            pattern += `(${multiCharVariants.map(v => escapeRegex(v)).join('|')})`;
                        }
                    }
                } else {
                    // Character not in map, use as-is
                    pattern += escapeRegex(char);
                }
                i++;
            }
        }
        
        return pattern;
    }

    // Escape special regex characters
    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Normalize Avar text for comparison (convert variants to base form)
    function normalizeAvarText(text) {
        if (!text) return '';
        
        let normalized = String(text).toLowerCase();
        
        // Normalize palochka variants (1, !) - remove them as they're already transliterated
        // Palochka can appear after consonants: т, к, ц, ч, л
        // For example: "bet1er" should match "beťer" (where 1 represents палочка)
        // Remove 1 and ! which are palochka variants
        // Note: We remove them unconditionally - if user types "be1er", it becomes "beer"
        // which won't match "beťer" -> "beter", but "bet1er" -> "beter" will match
        normalized = normalized.replace(/1/g, '');
        normalized = normalized.replace(/!/g, '');
        
        // Replace multi-character sequences first (before single char replacements)
        normalized = normalized.replace(/şç/g, 's');
        normalized = normalized.replace(/kļ/g, 'k');
        normalized = normalized.replace(/gh/g, 'g');
        normalized = normalized.replace(/kh/g, 'h');
        normalized = normalized.replace(/yu/g, 'y');
        normalized = normalized.replace(/ya/g, 'y');
        
        // Replace single character variants (including palochka-transliterated chars)
        // Order matters: replace longer/more specific variants first
        // Use global flag to replace all occurrences
        // Palochka-transliterated chars: ť (тӀ), ķ (кӀ), ź (цӀ), ć (чӀ), ł (лӀ)
        normalized = normalized.replace(/ł/g, 'l');   // лӀ -> l (palochka removed)
        normalized = normalized.replace(/ļ/g, 'l');    // лъ -> l
        normalized = normalized.replace(/ġ/g, 'g');
        normalized = normalized.replace(/ğ/g, 'g');
        normalized = normalized.replace(/ħ/g, 'h');
        normalized = normalized.replace(/ķ/g, 'k');   // кӀ -> k (palochka removed)
        normalized = normalized.replace(/q/g, 'k');
        normalized = normalized.replace(/ť/g, 't');    // тӀ -> t (palochka removed)
        normalized = normalized.replace(/ź/g, 'c');     // цӀ -> c (palochka removed)
        normalized = normalized.replace(/ž/g, 'c');
        normalized = normalized.replace(/ć/g, 'c');    // чӀ -> c (palochka removed)
        normalized = normalized.replace(/ş/g, 's');
        normalized = normalized.replace(/ê/g, 'e');
        normalized = normalized.replace(/ö/g, 'o');
        
        return normalized;
    }

    // Check if text matches query considering Avar character variants
    function matchesAvarQuery(text, query) {
        const textLower = text.toLowerCase();
        const queryLower = query.toLowerCase();
        
        // Direct match first (exact characters)
        if (textLower.includes(queryLower)) {
            return true;
        }
        
        // Normalized match - convert variants to base characters
        // This is the main method: "limer" will match "ļimer" after normalization
        const normalizedText = normalizeAvarText(text);
        const normalizedQuery = normalizeAvarText(query);
        if (normalizedText.includes(normalizedQuery)) {
            return true;
        }
        
        // For single character queries, check if any variant appears in text
        if (queryLower.length === 1) {
            const char = queryLower[0];
            if (charMap[char]) {
                const variants = charMap[char];
                for (const variant of variants) {
                    const variantLower = variant.toLowerCase();
                    if (textLower.includes(variantLower)) {
                        return true;
                    }
                }
            }
        }
        
        // For multi-character queries, build regex pattern with all variants
        // Example: "limer" -> "[lļł]i[m][eê]r" to match "ļimer", "łimer", etc.
        if (queryLower.length > 1) {
            try {
                const pattern = expandAvarQuery(query);
                if (pattern && pattern.length > 0) {
                    // The pattern should match the query with variants anywhere in the text
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(textLower)) {
                        return true;
                    }
                }
            } catch (e) {
                // If regex fails, fall back to normalized search only
                console.warn('Regex expansion failed for query:', query, e);
            }
        }
        
        return false;
    }

    // Search dictionary
    function searchDictionary(query) {
        const results = [];
        const queryLower = query.toLowerCase().trim();
        
        // Check if query contains Cyrillic characters
        const hasCyrillic = /[а-яёъ]/.test(queryLower);
        let searchQuery = queryLower;
        
        // If query contains Cyrillic, transliterate it to Latin first
        if (hasCyrillic) {
            searchQuery = transliterateCyrillic(queryLower);
        }
        
        const normalizedQuery = normalizeAvarText(searchQuery);
        
        for (const entry of dictionary) {
            const enLower = entry.en.toLowerCase();
            const avLower = entry.av.toLowerCase();
            const avCyrLower = entry.av_cyr ? entry.av_cyr.toLowerCase() : '';
            let matched = false;
            let matchType = '';
            
            // Check English text
            if (enLower === queryLower) {
                matchType = 'exact';
                matched = true;
            }
            else if (enLower.startsWith(queryLower)) {
                matchType = 'starts';
                matched = true;
            }
            else if (enLower.includes(queryLower)) {
                matchType = 'contains';
                matched = true;
            }
            
            // Check Avar Cyrillic text if query contains Cyrillic
            if (!matched && hasCyrillic && avCyrLower) {
                if (avCyrLower.includes(queryLower)) {
                    matchType = 'contains';
                    matched = true;
                }
            }
            
            // Check Avar Latin text if English didn't match
            if (!matched && entry.av) {
                // Direct match in Avar Latin text
                if (avLower.includes(searchQuery)) {
                    matchType = 'contains';
                    matched = true;
                }
            }
            
            // Normalized match - convert variants to base characters
            // Example: "limer" normalized = "limer", "ļimer rexi" normalized = "limer rexi"
            if (!matched && entry.av) {
                const normalizedAv = normalizeAvarText(entry.av);
                // Check if normalized Avar text contains normalized query
                if (normalizedAv && normalizedQuery) {
                    if (normalizedAv.indexOf(normalizedQuery) >= 0) {
                        matchType = 'contains';
                        matched = true;
                    }
                }
            }
            
            // Regex pattern matching as fallback
            if (!matched && entry.av && matchesAvarQuery(entry.av, searchQuery)) {
                matchType = 'contains';
                matched = true;
            }
            
            // Add to results if matched
            if (matched) {
                if (matchType === 'exact') {
                    results.unshift({ ...entry, matchType });
                } else {
                    results.push({ ...entry, matchType });
                }
            }
        }
        
        return results;
    }

    // Show suggestions dropdown
    function showSuggestions(results, query) {
        selectedSuggestionIndex = -1;
        
        if (results.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionsEl.innerHTML = results.map(entry => `
            <div class="suggestion-item" data-word="${escapeHtml(entry.en)}">
                <span>
                    <span class="word">${highlightMatch(entry.en, query)}</span>
                    <span class="pos">${entry.pos}</span>
                </span>
                <span class="translation">${escapeHtml(entry.av)}</span>
            </div>
        `).join('');

        // Add click handlers to suggestions
        suggestionsEl.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                searchInput.value = item.dataset.word;
                handleSearchInput({ target: searchInput });
                hideSuggestions();
            });
        });

        suggestionsEl.classList.add('active');
    }

    // Hide suggestions
    function hideSuggestions() {
        suggestionsEl.classList.remove('active');
        selectedSuggestionIndex = -1;
    }

    // Show search results
    function showResults(results, query) {
        if (results.length === 0) {
            resultsEl.innerHTML = `
                <div class="no-results">
                    <div class="icon">🔍</div>
                    <p>No results found for "${escapeHtml(query)}"</p>
                </div>
            `;
            resultsEl.classList.add('active');
            return;
        }

        const countText = results.length === 1 ? '1 result' : `${results.length} results`;
        
        resultsEl.innerHTML = `
            <div class="result-count">${countText} for "${escapeHtml(query)}"</div>
            ${results.slice(0, 50).map(entry => createWordCard(entry, query)).join('')}
            ${results.length > 50 ? `<p class="no-results">Showing first 50 of ${results.length} results</p>` : ''}
        `;
        
        resultsEl.classList.add('active');
    }

    // Hide results
    function hideResults() {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
    }

    // Create word card HTML
    function createWordCard(entry, query = '') {
        return `
            <div class="word-card">
                <div class="english">
                    ${query ? highlightMatch(entry.en, query) : escapeHtml(entry.en)}
                    <span class="pos">${entry.pos}</span>
                </div>
                <div class="avar">${escapeHtml(entry.av)}</div>
                <div class="avar-cyr">${escapeHtml(entry.av_cyr)}</div>
            </div>
        `;
    }

    // Show random words
    function showRandomWords() {
        const randomEntries = getRandomEntries(10);
        randomWordsEl.innerHTML = randomEntries.map(entry => createWordCard(entry)).join('');
    }

    // Get random entries from dictionary
    function getRandomEntries(count) {
        const shuffled = [...dictionary].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    // Show random section
    function showRandomSection() {
        randomSection.style.display = 'block';
    }

    // Hide random section
    function hideRandomSection() {
        randomSection.style.display = 'none';
    }

    // Highlight matching text
    function highlightMatch(text, query) {
        if (!query) return escapeHtml(text);
        
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        
        return escapeHtml(text).replace(regex, '<span class="highlight">$1</span>');
    }

    // Escape HTML entities
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Start app
    document.addEventListener('DOMContentLoaded', init);
})();

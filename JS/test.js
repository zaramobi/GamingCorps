/**
 * Explanation:
 * 1. Maximize word count (primary criterion)
 * 2. Among equal word counts, maximize total character usage (secondary criterion)
 * 3. Return ALL subsets that achieve both maximums, as every unique permutation
 *    of each subset (deduped via Set to handle repeated words in input).
 * 4. "." is not a valid sentence. Grammer is not important. The sentence starts with capital letter. 
 * The punctuations like "," will be removed before the process and not counted in the words
 * 
 *  The constraint is: total characters + spaces between words + "." <= limit
 */

function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const perm of permutations(rest)) {
            result.push([arr[i], ...perm]);
        }
    }
    return result;
}

function subsetsToSentences(subsets) {
    const seen = new Set();
    for (const subset of subsets) {
        if (subset.length === 0) continue; // "." alone is not a valid sentence
        for (const perm of permutations(subset)) {
            const sentence = perm.join(" ") + ".";
            // Capitalize the first letter
            seen.add(sentence[0].toUpperCase() + sentence.slice(1));
        }
    }
    return [...seen];
}

// ── Recursive backtracking ──────────────────────────────────────────────────

function rearrangeRecursive(maxLength, sentence) {
    if (!Number.isInteger(maxLength) || maxLength < 0) {
        throw new Error("maxLength must be a non-negative integer");
    }

    const words = sentence.slice(0, -1).trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(w => w.length > 0);

    let bestCount = 0;
    let bestChars = 0;
    const optimalSubsets = [];

    function record(chosen, charCount) {
        const count = chosen.length;
        if (count > bestCount || (count === bestCount && charCount > bestChars)) {
            bestCount = count;
            bestChars = charCount;
            optimalSubsets.length = 0;
            optimalSubsets.push([...chosen]);
        } else if (count === bestCount && charCount === bestChars) {
            optimalSubsets.push([...chosen]);
        }
    }

    // Only record at leaves so each subset is counted exactly once
    function backtrack(index, chosen, charCount) {
        if (index >= words.length) {
            record(chosen, charCount);
            return;
        }

        // Branch 1: skip words[index]
        backtrack(index + 1, chosen, charCount);

        // Branch 2: include words[index] if it fits
        const added = chosen.length === 0 ? words[index].length : words[index].length + 1;
        if (charCount + added + 1 <= maxLength) {
            chosen.push(words[index]);
            backtrack(index + 1, chosen, charCount + added);
            chosen.pop(); // ← actual backtrack step
        }
    }

    backtrack(0, [], 0);

    return subsetsToSentences(optimalSubsets);
}

// ── Iterative bitmask ───────────────────────────────────────────────────────

function rearrangeIterative(maxLength, sentence) {
    if (!Number.isInteger(maxLength) || maxLength < 0) {
        throw new Error("maxLength must be a non-negative integer");
    }

    const words = sentence.slice(0, -1).trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(w => w.length > 0);
    const n = words.length;
    const total = 1 << n; // 2^n subsets

    let bestCount = 0;
    let bestChars = 0;
    const optimalSubsets = [];

    for (let mask = 0; mask < total; mask++) {
        const subset = [];
        let charCount = 0;

        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) {
                const added = subset.length === 0 ? words[i].length : words[i].length + 1;
                charCount += added;
                subset.push(words[i]);
            }
        }

        // Skip if it doesn't fit (charCount + 1 for period must be <= maxLength)
        if (subset.length > 0 && charCount + 1 > maxLength) continue;

        const count = subset.length;
        if (count > bestCount || (count === bestCount && charCount > bestChars)) {
            bestCount = count;
            bestChars = charCount;
            optimalSubsets.length = 0;
            optimalSubsets.push(subset);
        } else if (count === bestCount && charCount === bestChars) {
            optimalSubsets.push(subset);
        }
    }

    return subsetsToSentences(optimalSubsets);
}

// ── Tests ───────────────────────────────────────────────────────────────────

function runTests() {
    const cases = [
        // [maxLength, sentence, description]
        [10, "I love cats and dogs.", "basic fit"],
        [5,  "hi bye ok.", "all equal-length 1-word subsets are optimal"],
        [0,  "hello world.", "zero limit → no valid sentence"],
        [1,  "a b c.", "limit=1 → no valid sentence"],
        [2,  "a b c.", "limit=2 → single 1-char words fit"],
        [100, "hello world.", "large limit fits all"],
        [6,  "ab cd ef.", "tie in word count, max chars wins"],
        [7,  "abc de f.", "multiple optimal subsets"],
        [7,  "abc do, abd de dd f.", "multiple optimal subsets"],
    ];

    for (const [limit, sent, desc] of cases) {
        const r = rearrangeRecursive(limit, sent);
        const it = rearrangeIterative(limit, sent);
        const rSorted = [...r].sort();
        const itSorted = [...it].sort();
        const match = JSON.stringify(rSorted) === JSON.stringify(itSorted);
        console.log(`[${match ? "PASS" : "FAIL"}] ${desc} (limit=${limit}, "${sent}")`);
        if (!match) {
            console.log("  recursive:", rSorted);
            console.log("  iterative:", itSorted);
        } else {
            console.log("  results:", rSorted);
        }
    }
}

runTests();

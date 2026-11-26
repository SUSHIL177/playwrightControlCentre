"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTestBlock = extractTestBlock;
exports.extractTestBlocks = extractTestBlocks;
function readStringLiteral(text, quoteIndex) {
    const quote = text[quoteIndex];
    let value = '';
    for (let i = quoteIndex + 1; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            const next = text[i + 1];
            if (next === undefined)
                return null;
            value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            i += 1;
            continue;
        }
        if (ch === quote)
            return { value, endOffset: i + 1 };
        value += ch;
    }
    return null;
}
const lineStartOffsets = (text) => {
    const offsets = [0];
    for (let i = 0; i < text.length; i++)
        if (text[i] === '\n')
            offsets.push(i + 1);
    return offsets;
};
const offsetToLine = (offsets, offset) => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] <= offset)
            lo = mid + 1;
        else
            hi = mid - 1;
    }
    return hi + 1; // 1-based
};
const TEST_CALL = /\b(?:test|it)\s*(?:\.\s*(?:only|skip|fixme|fail|slow|describe|parallel|serial))*\s*\(\s*(['"`])/g;
/** Build candidate raw titles for a test() block from a possibly-qualified full title. */
function titleCandidates(title) {
    const wanted = String(title || '').trim();
    const candidates = [wanted];
    // Playwright CLI: 'outer describe › inner › test name'; disk scan: 'Describe > title'
    const segments = wanted.split(/\s*(?:›|>)\s*/).map((s) => s.trim()).filter(Boolean);
    if (segments.length > 1)
        candidates.push(segments[segments.length - 1]);
    return Array.from(new Set(candidates));
}
function extractTestBlock(source, title) {
    const offsets = lineStartOffsets(source);
    for (const wanted of titleCandidates(title)) {
        const extraction = findTestBlock(source, wanted, offsets);
        if (extraction)
            return extraction;
    }
    return { found: false, startLine: 0, endLine: 0, source: '', bodySource: '', bodyStartLine: 0, steps: [], reason: `No test block titled "${String(title || '').trim()}" found in this spec.` };
}
function extractionFromMatch(source, match, offsets) {
    const quoteIndex = match.index + match[0].length - 1;
    const str = readStringLiteral(source, quoteIndex);
    if (!str) {
        return { found: false, startLine: 0, endLine: 0, source: '', bodySource: '', steps: [], bodyStartLine: 0, reason: 'Unreadable test title string.' };
    }
    const afterTitle = str.endOffset;
    // Locate the function body: an arrow function (=>) or `function` keyword — the
    // body is the first '{' after it (skips destructured `async ({ page })` args).
    const rest = source.slice(afterTitle);
    const arrowIdx = rest.indexOf('=>');
    const funcIdx = rest.indexOf('function');
    let bodyBrace = -1;
    if (arrowIdx !== -1 && (funcIdx === -1 || arrowIdx < funcIdx)) {
        bodyBrace = source.indexOf('{', afterTitle + arrowIdx);
    }
    else if (funcIdx !== -1) {
        bodyBrace = source.indexOf('{', afterTitle + funcIdx);
    }
    if (bodyBrace === -1) {
        return { found: false, startLine: 0, endLine: 0, source: '', bodySource: '', steps: [], bodyStartLine: 0, reason: 'Test body is a function reference — cannot be inlined for analysis.' };
    }
    // Balance braces from bodyBrace to find the end of the block.
    let depth = 0;
    let inStr = null;
    let endOffset = -1;
    for (let i = bodyBrace; i < source.length; i++) {
        const ch = source[i];
        if (inStr) {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === inStr)
                inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
            continue;
        }
        if (ch === '{')
            depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                endOffset = i;
                break;
            }
        }
    }
    if (endOffset === -1) {
        return { found: false, startLine: 0, endLine: 0, source: '', bodySource: '', steps: [], bodyStartLine: 0, reason: 'Unbalanced braces — could not locate the end of the test block.' };
    }
    const startLine = offsetToLine(offsets, match.index);
    const endLine = offsetToLine(offsets, endOffset);
    const blockSource = source.slice(match.index, endOffset + 1);
    const bodySource = source.slice(bodyBrace, endOffset + 1);
    const bodyStartLine = offsetToLine(offsets, bodyBrace);
    const steps = classifySteps(bodySource, bodyStartLine);
    return { found: true, startLine, endLine, source: blockSource, bodySource, bodyStartLine, steps, startOffset: match.index, endOffset: endOffset + 1 };
}
function findTestBlock(source, wanted, offsets) {
    let match;
    TEST_CALL.lastIndex = 0;
    while ((match = TEST_CALL.exec(source)) !== null) {
        const quoteIndex = match.index + match[0].length - 1;
        const str = readStringLiteral(source, quoteIndex);
        if (!str || str.value !== wanted)
            continue;
        return extractionFromMatch(source, match, offsets);
    }
    return null;
}
/**
 * Enumerate EVERY test block in a spec file — the advisor's import-time analysis is built
 * on this (no discovery run, no execution history). Blocks that cannot be isolated are
 * returned with `found: false` and a `reason`.
 */
function extractTestBlocks(source) {
    const offsets = lineStartOffsets(source);
    const blocks = [];
    let match;
    TEST_CALL.lastIndex = 0;
    while ((match = TEST_CALL.exec(source)) !== null) {
        const quoteIndex = match.index + match[0].length - 1;
        const str = readStringLiteral(source, quoteIndex);
        const title = str?.value ?? '';
        blocks.push({ ...extractionFromMatch(source, match, offsets), title });
    }
    return blocks;
}
const cleanLine = (raw) => raw
    .trim()
    .replace(/^await\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/;+$/, '')
    .trim()
    .slice(0, 160);
function classifySteps(bodySource, bodyStartLine) {
    const steps = [];
    const bodyLines = bodySource.split('\n');
    for (let i = 0; i < bodyLines.length; i++) {
        const raw = bodyLines[i];
        const lineNo = bodyStartLine + i;
        const trimmed = raw.trim();
        if (!trimmed)
            continue;
        if (/^[})\]]+;?$/.test(trimmed))
            continue; // bare closers
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
            continue;
        const code = cleanLine(raw);
        if (!code)
            continue;
        const stepLabel = trimmed.match(/test\.step\s*\(\s*(['"`])/);
        const kind = classifyLine(trimmed, stepLabel !== null);
        if (!kind)
            continue;
        steps.push({ index: steps.length + 1, kind, line: lineNo, code });
    }
    return steps;
}
function classifyLine(trimmed, isStep) {
    if (isStep)
        return 'step';
    if (/\bexpect\s*\(/.test(trimmed))
        return 'assertion';
    if (/waitFor(Timeout|LoadState|Selector|URL|Response|Request|Function|Event|FileChooser|Download)\b/i.test(trimmed))
        return 'wait';
    if (/\.goto\s*\(/.test(trimmed))
        return 'navigation';
    if (/\.(fill|type|press|pressSequentially|selectOption|check|uncheck|setChecked|setInputFiles|clear|selectText)\s*\(/.test(trimmed))
        return 'input';
    if (/keyboard\.(press|type|down|up|insertText)\b/i.test(trimmed))
        return 'input';
    if (/\.(click|dblclick|tap|hover|focus|blur|scrollIntoViewIfNeeded|scrollTo|dragTo)\s*\(/.test(trimmed))
        return 'action';
    if (/\.dragAndDrop\s*\(/.test(trimmed))
        return 'action';
    if (/\bawait\b/.test(trimmed) && /(page|locator|getBy|frame)/i.test(trimmed))
        return 'action';
    if (/\bawait\b/.test(trimmed))
        return 'action';
    return null;
}

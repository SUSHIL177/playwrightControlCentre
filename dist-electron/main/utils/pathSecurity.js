"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertPathWithinRoot = assertPathWithinRoot;
exports.normalizeWinPath = normalizeWinPath;
exports.ensureDirSync = ensureDirSync;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function assertPathWithinRoot(projectRoot, targetPath) {
    const resolvedRoot = path_1.default.resolve(projectRoot);
    const resolvedTarget = path_1.default.resolve(targetPath);
    const relative = path_1.default.relative(resolvedRoot, resolvedTarget);
    if (relative.startsWith('..') || path_1.default.isAbsolute(relative)) {
        throw new Error(`Security Violation: Path "${resolvedTarget}" escapes project root "${resolvedRoot}".`);
    }
    return resolvedTarget;
}
function normalizeWinPath(inputPath) {
    return path_1.default.normalize(inputPath.trim().replace(/^["']+|["']+$/g, ''));
}
function ensureDirSync(dirPath) {
    if (!fs_1.default.existsSync(dirPath)) {
        fs_1.default.mkdirSync(dirPath, { recursive: true });
    }
}

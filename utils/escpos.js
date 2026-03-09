/**
 * ESC/POS Command Builder — GingrPOS Print Server
 *
 * Comprehensive byte-level builder for ESC/POS thermal printers.
 * Supports 58mm (32 chars) and 80mm (48 chars) paper widths.
 *
 * Specifications:
 *   - ESC/POS Command standard
 *   - Font A: 80mm → 42–48 chars wide; 58mm → 32 chars wide
 *   - UTF-8 text encoding
 *   - QR Code via GS (k) command
 *   - Cash drawer pulse via ESC p
 */

'use strict';

const CMD = {
    // Init
    INIT: [0x1b, 0x40],

    // Line Feed
    LF: [0x0a],

    // Alignment
    ALIGN_LEFT:   [0x1b, 0x61, 0x00],
    ALIGN_CENTER: [0x1b, 0x61, 0x01],
    ALIGN_RIGHT:  [0x1b, 0x61, 0x02],

    // Bold
    BOLD_ON:  [0x1b, 0x45, 0x01],
    BOLD_OFF: [0x1b, 0x45, 0x00],

    // Underline
    UNDERLINE_ON:  [0x1b, 0x2d, 0x01],
    UNDERLINE_OFF: [0x1b, 0x2d, 0x00],

    // Text Size (GS ! n)
    SIZE_NORMAL:        [0x1d, 0x21, 0x00],
    SIZE_DOUBLE_HEIGHT: [0x1d, 0x21, 0x01],
    SIZE_DOUBLE_WIDTH:  [0x1d, 0x21, 0x10],
    SIZE_DOUBLE:        [0x1d, 0x21, 0x11],

    // Font
    FONT_A: [0x1b, 0x4d, 0x00],
    FONT_B: [0x1b, 0x4d, 0x01],

    // Cut
    CUT_FULL:    [0x1d, 0x56, 0x00],
    CUT_PARTIAL: [0x1d, 0x56, 0x01],

    // Cash Drawer
    CASH_DRAWER: [0x1b, 0x70, 0x00, 0x19, 0xfa],

    // Invert / Dark mode
    INVERT_ON:  [0x1d, 0x42, 0x01],
    INVERT_OFF: [0x1d, 0x42, 0x00],
};

class ESCPOSBuilder {
    /**
     * @param {number} [width=48] - Paper width in chars (32 for 58mm, 48 for 80mm)
     */
    constructor(width = 48) {
        this.buffer = [];
        this.width = width;
    }

    // ──────────────────────── LOW LEVEL ────────────────────────

    add(bytes) {
        if (Array.isArray(bytes)) {
            this.buffer.push(...bytes);
        } else if (typeof bytes === 'number') {
            this.buffer.push(bytes);
        } else if (Buffer.isBuffer(bytes)) {
            this.buffer.push(...bytes);
        }
        return this;
    }

    // ──────────────────────── INIT / FONT ─────────────────────

    init() { return this.add(CMD.INIT); }
    fontA() { return this.add(CMD.FONT_A); }
    fontB() { return this.add(CMD.FONT_B); }

    // ─────────────────────── ALIGNMENT ────────────────────────

    align(a) {
        switch ((a || '').toLowerCase()) {
            case 'center': return this.add(CMD.ALIGN_CENTER);
            case 'right':  return this.add(CMD.ALIGN_RIGHT);
            default:       return this.add(CMD.ALIGN_LEFT);
        }
    }

    // ─────────────────────── STYLES ───────────────────────────

    bold(on = true)      { return this.add(on ? CMD.BOLD_ON : CMD.BOLD_OFF); }
    underline(on = true) { return this.add(on ? CMD.UNDERLINE_ON : CMD.UNDERLINE_OFF); }
    invert(on = true)    { return this.add(on ? CMD.INVERT_ON : CMD.INVERT_OFF); }

    size(s) {
        switch ((s || '').toLowerCase()) {
            case 'double': return this.add(CMD.SIZE_DOUBLE);
            case 'height': return this.add(CMD.SIZE_DOUBLE_HEIGHT);
            case 'width':  return this.add(CMD.SIZE_DOUBLE_WIDTH);
            default:       return this.add(CMD.SIZE_NORMAL);
        }
    }

    // ─────────────────────── TEXT ─────────────────────────────

    text(content, encoding = 'utf8') {
        if (!content) return this;
        try {
            return this.add(Buffer.from(String(content), encoding));
        } catch (e) {
            console.error('[ESCPOSBuilder] Encoding error:', e.message);
            return this;
        }
    }

    textLn(content) {
        return this.text(content).add(CMD.LF);
    }

    newLine(count = 1) {
        for (let i = 0; i < count; i++) this.add(CMD.LF);
        return this;
    }

    // ─────────────────────── LAYOUT HELPERS ───────────────────

    /**
     * Print a horizontal separator line
     * @param {string} [char='-']
     * @param {number} [length] - defaults to paper width
     */
    line(char = '-', length) {
        return this.textLn(char.repeat(length || this.width));
    }

    /**
     * Key-value pair on one line: "Key         Value"
     */
    kv(key, value, width) {
        const w = width || this.width;
        const k = String(key);
        const v = String(value);
        if (k.length + v.length + 1 <= w) {
            const spaces = w - k.length - v.length;
            return this.textLn(k + ' '.repeat(spaces) + v);
        }
        return this.textLn(k).align('right').textLn(v).align('left');
    }

    /**
     * Two-column row — left/right with space padding
     */
    row(left, right, width) {
        const w = width || this.width;
        const l = String(left || '');
        const r = String(right || '');
        const space = w - l.length - r.length;
        if (space < 1) {
            return this.textLn(l.substring(0, w - r.length - 1) + ' ' + r);
        }
        return this.textLn(l + ' '.repeat(space) + r);
    }

    /**
     * Center text within paper width
     */
    centered(text, width) {
        const w = width || this.width;
        const s = String(text || '');
        const pad = Math.max(0, Math.floor((w - s.length) / 2));
        return this.textLn(' '.repeat(pad) + s);
    }

    // ─────────────────────── SPECIAL ──────────────────────────

    /**
     * Open cash drawer
     */
    cashDrawer() { return this.add(CMD.CASH_DRAWER); }

    /**
     * Paper cut (partial by default)
     */
    cut(full = false) {
        return this.newLine(3).add(full ? CMD.CUT_FULL : CMD.CUT_PARTIAL);
    }

    /**
     * QR Code (Model 2, size 4, error correction M)
     * @param {string} data
     * @param {number} [size=4]
     */
    qrCode(data, size = 4) {
        const bytes = Buffer.from(data, 'utf8');
        const len = bytes.length + 3;
        const pL = len & 0xff;
        const pH = (len >> 8) & 0xff;

        // Model: GS ( k pL pH cn 65 48 49
        this.add([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
        // Size: GS ( k 03 00 31 43 <size>
        this.add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);
        // Error level M: GS ( k 03 00 31 45 50
        this.add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x32]);
        // Store: GS ( k pL pH 31 50 30 <data>
        this.add([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
        this.add(bytes);
        // Print: GS ( k 03 00 31 51 30
        this.add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);

        return this;
    }

    // ─────────────────────── OUTPUT ───────────────────────────

    toBuffer() {
        return Buffer.from(this.buffer);
    }

    toArray() {
        return this.buffer.slice();
    }
}

module.exports = ESCPOSBuilder;

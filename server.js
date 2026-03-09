/**
 * GingrPOS Local Print Server
 *
 * Lightweight HTTP server on port 3000.
 * GingrPOS calls this instead of QZ Tray — no browser "Allow" prompts.
 *
 * Routes:
 *   GET  /health    — liveness check
 *   GET  /printers  — list system printers
 *   POST /print     — send receipt to printer
 *
 * All responses include Access-Control-Allow-Private-Network: true so Chrome's
 * Private Network Access preflight is satisfied silently.
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { exec }  = require('child_process');
const os         = require('os');
const fs         = require('fs');
const path       = require('path');

const ESCPOSBuilder     = require('./utils/escpos');
const { generateReceipt } = require('./driver/receiptDriver');

const PORT = 3000;
const app  = express();

// ─── CORS / Private Network Access ────────────────────────────────────────────
// This middleware runs before every request — including OPTIONS preflight.
// It sets the PNA header that Chrome requires for public→localhost requests.
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Origin',  req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight immediately
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '10mb' }));

// ─── LOGGING ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', port: PORT, app: 'GingrPOS Print Server' });
});

// ─── GET /printers ────────────────────────────────────────────────────────────
app.get('/printers', (req, res) => {
    const platform = os.platform();

    const parsePrinters = (stdout) =>
        stdout
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && l.toLowerCase() !== 'name')
            .map(name => ({ name, status: 'Ready' }));

    if (platform === 'win32') {
        const cmd = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' +
                    ' -NoProfile -NonInteractive -ExecutionPolicy Bypass' +
                    ' -Command "Get-Printer | Select-Object -ExpandProperty Name"';

        exec(cmd, { encoding: 'utf8', timeout: 6000 }, (err, stdout, stderr) => {
            if (err) {
                console.error('[printers] PowerShell failed, trying WMIC:', err.message);
                // Fallback to wmic
                exec('wmic printer get name', { encoding: 'utf8' }, (e2, out2) => {
                    if (e2) return res.status(500).json({ error: 'Cannot list printers', details: e2.message });
                    return res.json(parsePrinters(out2));
                });
                return;
            }
            res.json(parsePrinters(stdout));
        });

    } else {
        // Linux / macOS
        exec('lpstat -e', { encoding: 'utf8' }, (err, stdout) => {
            if (err) {
                // lpstat not available — return empty
                console.warn('[printers] lpstat failed:', err.message);
                return res.json([]);
            }
            res.json(parsePrinters(stdout));
        });
    }
});

// ─── POST /print ──────────────────────────────────────────────────────────────
// Body:
//   {
//     printerName : string           — system printer name
//     rawLines    : string[]         — from GingrPOS ElectronReceipt80mm
//     cut         : boolean          — true to cut paper (default true)
//     config      : { paperWidth }   — optional, used if rawLines absent
//     order       : {}               — passed to receiptDriver if rawLines absent
//     store       : {}               — passed to receiptDriver if rawLines absent
//   }
app.post('/print', (req, res) => {
    const { printerName, rawLines, cut = true, config = {}, order, store } = req.body;

    if (!printerName) {
        return res.status(400).json({ error: 'printerName is required' });
    }

    console.log(`[print] Job for "${printerName}", rawLines: ${rawLines?.length ?? 'none'}`);

    try {
        let buffer;

        if (rawLines && Array.isArray(rawLines) && rawLines.length > 0) {
            // ── Mode A: rawLines[] from GingrPOS ──────────────────────────────
            // Convert each text line into ESC/POS bytes
            const b = new ESCPOSBuilder(config.paperWidth === 58 ? 32 : 48);
            b.init();
            for (const line of rawLines) {
                b.textLn(line);
            }
            if (cut !== false) b.cut();
            buffer = b.toBuffer();

        } else if (order) {
            // ── Mode B: structured order object ───────────────────────────────
            buffer = generateReceipt({ order, store: store || {}, config });

        } else {
            return res.status(400).json({ error: 'Either rawLines or order is required' });
        }

        // Write to temp file
        const tmpFile = path.join(os.tmpdir(), `gingrpos_print_${Date.now()}.bin`);
        fs.writeFileSync(tmpFile, buffer);

        const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };
        const platform = os.platform();

        if (platform === 'win32') {
            // Windows: PowerShell RAW printing (no share required)
            const psScript = path.join(__dirname, 'print_raw.ps1');
            const cmd = `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` +
                        ` -ExecutionPolicy Bypass -File "${psScript}"` +
                        ` -PrinterName "${printerName}" -FilePath "${tmpFile}"`;

            exec(cmd, (err, stdout, stderr) => {
                cleanup();
                if (err) {
                    console.error('[print] Windows error:', stderr || err.message);
                    return res.status(500).json({ success: false, error: stderr || err.message });
                }
                console.log('[print] Windows success');
                res.json({ success: true, message: 'Printed' });
            });

        } else {
            // Linux / macOS: CUPS via lp
            const cmd = `lp -d "${printerName}" -o raw "${tmpFile}"`;
            exec(cmd, (err, stdout, stderr) => {
                cleanup();
                if (err) {
                    console.error('[print] Unix error:', stderr || err.message);
                    return res.status(500).json({ success: false, error: stderr || err.message });
                }
                console.log('[print] Unix success:', stdout.trim());
                res.json({ success: true, message: 'Printed' });
            });
        }

    } catch (e) {
        console.error('[print] Unexpected error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─── START ────────────────────────────────────────────────────────────────────
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`GingrPOS Print Server running at http://localhost:${PORT}`);
        console.log('Waiting for print jobs from GingrPOS...');
    });
}

module.exports = app;

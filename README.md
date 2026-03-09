# GingrPOS Print Server

GingrPOS Print Server is a lightweight local HTTP bridge for thermal receipt printers. It eliminates the need for QZ Tray and browser "Allow" prompts for private network access.

## Features

- **Port 3000**: Runs a local HTTP server that GingrPOS can call via standard `fetch()`.
- **Silent Operation**: Runs in the system tray.
- **Auto-Discovery**: Automatically finds local system printers.
- **Direct RAW Printing**: Sends ESC/POS commands directly to the printer without requiring a "shared" printer.
- **No Configuration Needed**: Pre-configured to work with GingrPOS web out of the box.

## Installation (Windows)

1. Download `GingrPOS-Print-Setup.exe`.
2. Run the installer.
3. The server will start automatically and appear in your system tray.

## Building from Source

If you want to build the installer yourself:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the Windows installer:
   ```bash
   npm run build:win
   ```
   The installer will be in the `dist/` directory.

## Technical Details

- **Technology**: Electron + Express.js.
- **CORS**: Handles Chrome Private Network Access (PNA) preflight requests automatically (`Access-Control-Allow-Private-Network: true`).
- **Printing**: Uses a custom PowerShell script (`print_raw.ps1`) for direct byte-level printing to Windows printers.

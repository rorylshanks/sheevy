#!/usr/bin/env node

/**
 * sheevy.js
 *
 * A simple Express.js app that:
 *  - Reads Google Sheets data via a service account JSON file
 *  - Serves the entire sheet/tab as CSV on the route: /:spreadsheetId/:sheetName
 *  - Allows specifying (via ?headerRow=N) which row in the sheet is treated as the header row
 *    for determining how many columns each row should have.
 *  - Ignores all rows before the specified header row.
 *  - Safely handles newlines inside cells (by enclosing them in quotes).
 *  - Logs basic events to the console.
 *
 * Prerequisites:
 *   1) npm install express googleapis
 *   2) Have a valid service account JSON key path:
 *      - Set via an environment variable GOOGLE_APPLICATION_CREDENTIALS
 *        or
 *      - Hardcode a fallback in this file.
 *
 * Usage:
 *   node sheevy.js
 *   Then access: http://localhost:3000/<spreadsheetId>/<sheetName>?headerRow=2
 *   - If ?headerRow is omitted, defaults to 1 (the first row).
 *   - The specified header row is used to determine column count, and
 *     all rows before it are ignored in the output.
 */

const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');

/**
 * Path to your service account credentials JSON file.
 */
const CREDS_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || '/path/to/google_creds.json';

/**
 * Converts a row (array of cell values) into a CSV line, handling commas, quotes,
 * and newlines by enclosing them in quotes as needed.
 */
function toCsvLine(rowArray) {
  return rowArray
    .map((val) => {
      // Convert null/undefined to empty, otherwise to string
      const cell = val == null ? '' : String(val);

      // Normalize any \r\n or \r to \n, so we handle multiline consistently
      const normalized = cell.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Escape double quotes by doubling them
      const escaped = normalized.replace(/"/g, '""');

      // If there's a newline, quote, or comma, wrap in quotes
      if (escaped.search(/["\n,]/) !== -1) {
        return `"${escaped}"`;
      }

      return escaped;
    })
    .join(',');
}

/**
 * Creates an authenticated Google client using service account JSON credentials from file.
 */
async function getAuthClient() {
  let credentials;
  try {
    const raw = fs.readFileSync(CREDS_PATH, 'utf8');
    credentials = JSON.parse(raw);
  } catch (err) {
    console.error(`[sheevy] Error reading credentials from ${CREDS_PATH}:`, err.message);
    process.exit(1);
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/**
 * Fetches all used data from the given sheet/tab.
 * Using just the sheet name for range returns all used rows/columns automatically.
 */
async function fetchEntireSheet(spreadsheetId, sheetName, auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const range = sheetName; // e.g. "Sheet1"

  console.log(
    `[sheevy] Fetching data for sheet "${sheetName}" in spreadsheet "${spreadsheetId}"...`
  );
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = res.data.values || [];
  console.log(`[sheevy] Fetched ${rows.length} rows for sheet "${sheetName}".`);
  return rows;
}

(async function main() {
  const authClient = await getAuthClient();
  const app = express();

  // Simple logger middleware
  app.use((req, res, next) => {
    console.log(`[sheevy] Incoming request: ${req.method} ${req.url}`);
    next();
  });

  /**
   * GET /:spreadsheetId/:sheetName
   * Optional query param: ?headerRow=N (1-based index)
   *   - Tells which row to treat as the header row for determining the column count.
   *   - All rows before this row are ignored entirely.
   */
  app.get('/:spreadsheetId/:sheetName', async (req, res) => {
    const { spreadsheetId, sheetName } = req.params;
    if (!spreadsheetId || !sheetName) {
      console.error('[sheevy] Missing spreadsheetId or sheetName in the URL path.');
      return res.status(400).send('Missing spreadsheetId or sheetName.');
    }

    // Default header row is 1 if not specified
    const headerRowParam = req.query.headerRow;
    const headerRow = headerRowParam ? parseInt(headerRowParam, 10) : 1;

    let rows = [];
    try {
      rows = await fetchEntireSheet(spreadsheetId, sheetName, authClient);
    } catch (error) {
      console.error(`[sheevy] Error fetching sheet data: ${error.message}`);
      return res.status(500).send(`Error fetching sheet data: ${error.message}`);
    }

    // If no rows, return empty CSV
    if (rows.length === 0) {
      console.log('[sheevy] No data found for this sheet.');
      res.type('text/csv');
      return res.send('');
    }

    // Validate the headerRow is within range
    if (headerRow < 1 || headerRow > rows.length) {
      console.error(`[sheevy] headerRow=${headerRow} is out of range. Total rows: ${rows.length}`);
      return res
        .status(400)
        .send(`headerRow=${headerRow} is out of range (1..${rows.length}).`);
    }

    // Convert user-specified header row (1-based) to zero-based index
    const headerIndex = headerRow - 1;

    // Slice off all rows before the header row
    rows = rows.slice(headerIndex);

    // If, after slicing, we have no rows, just return empty
    if (rows.length === 0) {
      console.log('[sheevy] No data remains after ignoring rows before headerRow.');
      res.type('text/csv');
      return res.send('');
    }

    // Determine the column count based on the new first row (the chosen header row)
    const colCount = rows[0].length;

    // Normalize each row to have exactly colCount columns
    const normalizedRows = rows.map((row) => {
      const padded = row.slice(0, colCount);
      while (padded.length < colCount) {
        padded.push('');
      }
      return padded;
    });

    // Convert each row to CSV lines
    const csvLines = normalizedRows.map(toCsvLine);
    const csvContent = csvLines.join('\n');

    console.log(
      `[sheevy] Sending CSV with ${normalizedRows.length} rows, based on row #${headerRow} as header (colCount=${colCount}).`
    );
    res.type('text/csv').send(csvContent);
  });

  // Start server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[sheevy] Server is listening on port ${port}`);
  });
})();

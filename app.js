#!/usr/bin/env node

/**
 * sheevy.js
 *
 * A simple Express.js app that:
 *  - Reads Google Sheets data via a service account JSON file
 *  - Serves the entire sheet/tab as CSV on the route: /:spreadsheetId/:sheetParam
 *  - Allows specifying (via ?headerRow=N) which row in the sheet is the header row,
 *    ignoring all rows before it and using it to determine column count.
 *  - When raw=1 is provided, downloads the entire sheet without header parsing,
 *    and generates headers as A, B, C, etc. (based on the max column count)
 *  - Allows specifying a tab index instead of a tab name when useTabIndex=1 is provided.
 *  - Safely handles newlines and commas inside cells by enclosing them in quotes.
 *  - Logs basic events to the console.
 *  - Uses the "cache" NPM package for in-memory caching (expires after 30 seconds).
 *
 * Prerequisites:
 *   1) npm install express googleapis cache
 *   2) Have a valid service account JSON key file:
 *      - Set via an environment variable GOOGLE_APPLICATION_CREDENTIALS
 *        or
 *      - Hardcode a fallback in this file.
 *
 * Usage:
 *   node sheevy.js
 *   Then access for header parsing:
 *     http://localhost:3000/<spreadsheetId>/<sheetName>?headerRow=2
 *   Or for raw download (with auto-generated headers):
 *     http://localhost:3000/<spreadsheetId>/<sheetName>?raw=1
 *   And if you want to use a tab index (zero-based) instead of a tab name, add:
 *     &useTabIndex=1
 */

const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const Cache = require('cache'); // npm install cache

/**
 * Path to your service account credentials JSON file.
 */
const CREDS_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || '/path/to/google_creds.json';

/**
 * In-memory cache using the "cache" package.
 * We'll store rows from Google Sheets for 30 seconds.
 */
const memoryCache = new Cache();
const CACHE_TTL_MS = 30_000; // 30 seconds

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
 * Fetches all used data from the given sheet/tab. Using just the sheet name for range
 * returns all used rows and columns automatically.
 */
async function fetchEntireSheet(spreadsheetId, sheetName, auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const range = sheetName; // e.g. "Sheet1"

  console.log(
    `[sheevy] Fetching data for sheet "${sheetName}" in spreadsheet "${spreadsheetId}"...`
  );
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];
  console.log(`[sheevy] Fetched ${rows.length} rows for sheet "${sheetName}".`);
  return rows;
}

/**
 * Fetches a sheet by its index (zero-based). It first retrieves the spreadsheet metadata,
 * selects the sheet at the specified index, and then fetches its entire data.
 */
async function fetchSheetByIndex(spreadsheetId, tabIndex, auth) {
  const sheetsApi = google.sheets({ version: 'v4', auth });
  console.log(
    `[sheevy] Fetching spreadsheet metadata for spreadsheet "${spreadsheetId}" to use tab index ${tabIndex}...`
  );
  const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const sheetsArray = spreadsheet.data.sheets;
  if (!sheetsArray || tabIndex < 0 || tabIndex >= sheetsArray.length) {
    throw new Error(`Invalid tab index: ${tabIndex}. There are ${sheetsArray ? sheetsArray.length : 0} tabs.`);
  }
  const sheetName = sheetsArray[tabIndex].properties.title;
  console.log(`[sheevy] Using sheet "${sheetName}" (tab index ${tabIndex}).`);
  return await fetchEntireSheet(spreadsheetId, sheetName, auth);
}

/**
 * Helper function: Removes columns whose header (first row) is empty ("NULL" header) or '#N/A'.
 * Returns a new 2D array with only columns that have a non-empty header.
 */
function removeInvalidHeaders(rows) {
  if (rows.length === 0) {
    return rows;
  }
  // Get the header row.
  var header = rows[0];
  var indicesToKeep = [];
  // Identify indices of valid headers.
  for (var i = 0; i < header.length; i++) {
    var cell = header[i];
    if (cell !== '' && cell !== '#N/A' && cell !== '#REF!') {
      indicesToKeep.push(i);
    }
  }
  // Create a new array including only the valid columns for each row.
  var filteredRows = [];
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var newRow = [];
    for (var k = 0; k < indicesToKeep.length; k++) {
      var index = indicesToKeep[k];
      if (index < row.length) {
        newRow.push(row[index]);
      } else {
        newRow.push('');
      }
    }
    filteredRows.push(newRow);
  }
  return filteredRows;
}

/**
 * Helper function: Normalizes rows based on the specified headerRow (ignoring rows above it),
 * optionally removes columns with NULL (empty) header names (if allowNullableHeaders is false),
 * then sends them as CSV in the response.
 */
function sendCsv(rows, headerRow, res, allowNullableHeaders) {
  if (rows.length === 0) {
    console.log('[sheevy] No data found for this sheet.');
    res.type('text/csv');
    return res.send('');
  }
  if (headerRow > rows.length) {
    console.error(`[sheevy] headerRow=${headerRow} is out of range. Total rows: ${rows.length}`);
    return res
      .status(400)
      .send(`headerRow=${headerRow} is out of range (1..${rows.length}).`);
  }
  // Slice off all rows before the header row
  const headerIndex = headerRow - 1;
  const slicedRows = rows.slice(headerIndex);
  if (slicedRows.length === 0) {
    console.log('[sheevy] No data remains after ignoring rows before headerRow.');
    res.type('text/csv');
    return res.send('');
  }
  // Determine the column count based on the new first row
  const colCount = slicedRows[0].length;
  // Normalize each row to have exactly colCount columns
  let normalizedRows = slicedRows.map((row) => {
    const padded = row.slice(0, colCount);
    while (padded.length < colCount) {
      padded.push('');
    }
    return padded;
  });
  // Remove any columns with a NULL (empty) header unless allowNullableHeaders is set
  if (!allowNullableHeaders) {
    normalizedRows = removeInvalidHeaders(normalizedRows);
  }
  // Convert each row to CSV lines
  const csvLines = normalizedRows.map(toCsvLine);
  const csvContent = csvLines.join('\n');
  console.log(
    `[sheevy] Sending CSV with ${normalizedRows.length} rows (row #${headerRow} as header, colCount=${normalizedRows[0].length}).`
  );
  res.type('text/csv').send(csvContent);
}

/**
 * Helper function: Given an index (0-based), returns its corresponding Excel-style column name.
 * E.g., 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, etc.
 */
function getColumnName(n) {
  let result = '';
  n++;
  while (n > 0) {
    let rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Sends CSV output of the entire sheet without any header row parsing. It generates a header row
 * as A, B, C, etc. (with enough columns to cover the maximum column count among all rows) and then
 * outputs all rows from the sheet.
 */
function sendRawCsv(rows, res) {
  if (!rows || rows.length === 0) {
    console.log('[sheevy] No data found for this sheet.');
    res.type('text/csv');
    return res.send('');
  }
  // Determine the maximum number of columns across all rows
  let maxCols = 0;
  rows.forEach((row) => {
    if (row.length > maxCols) {
      maxCols = row.length;
    }
  });
  // Generate header row as A, B, C, etc.
  const headers = [];
  for (let i = 0; i < maxCols; i++) {
    headers.push(getColumnName(i));
  }
  // Prepend the generated header row to the data
  const allRows = [headers, ...rows];
  // Convert each row to CSV lines
  const csvLines = allRows.map(toCsvLine);
  const csvContent = csvLines.join('\n');
  console.log(
    `[sheevy] Sending raw CSV with ${allRows.length} rows (generated header with ${maxCols} columns).`
  );
  res.type('text/csv').send(csvContent);
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
   * GET /:spreadsheetId/:sheetParam
   *
   * Query params:
   *   - headerRow=N (1-based index): Which row to treat as header for determining column count.
   *     Ignored if raw=1.
   *   - allowNulableHeaders=1: If set to "1", columns with NULL header names will NOT be removed.
   *   - raw=1: Download the entire sheet as-is without header row parsing.
   *           The output will include a generated header row (A, B, C, etc.) covering all columns.
   *   - useTabIndex=1: Treat the second URL parameter as a zero-based tab index instead of a sheet name.
   */
  app.get('/:spreadsheetId/:sheetParam', async (req, res) => {
    const { spreadsheetId, sheetParam } = req.params;
    if (!spreadsheetId || !sheetParam) {
      console.error('[sheevy] Missing spreadsheetId or sheetParam in the URL path.');
      return res.status(400).send('Missing spreadsheetId or sheetParam.');
    }

    // Determine if we should output raw CSV
    const raw = req.query.raw === '1';
    // Determine if the sheetParam is a tab index
    const useTabIndex = req.query.useTabIndex === '1';

    // Build cache key to include flags and parameters
    let cacheKey;
    if (raw) {
      cacheKey = `${spreadsheetId}::${sheetParam}::raw::useTabIndex=${useTabIndex}`;
    } else {
      const headerRowParam = req.query.headerRow;
      const headerRow = headerRowParam ? parseInt(headerRowParam, 10) : 1;
      cacheKey = `${spreadsheetId}::${sheetParam}::headerRow=${headerRow}::allowNullableHeaders=${req.query.allowNulableHeaders}::useTabIndex=${useTabIndex}`;
    }

    const cachedResult = memoryCache.get(cacheKey);
    if (cachedResult) {
      console.log(`[sheevy] Cache hit for key: ${cacheKey}`);
      if (raw) {
        return sendRawCsv(cachedResult, res);
      } else {
        const headerRowParam = req.query.headerRow;
        const headerRow = headerRowParam ? parseInt(headerRowParam, 10) : 1;
        const allowNullableHeaders = req.query.allowNulableHeaders === '1';
        return sendCsv(cachedResult, headerRow, res, allowNullableHeaders);
      }
    }

    // Otherwise, fetch from Sheets
    console.log(`[sheevy] Cache miss for key: ${cacheKey}`);
    let rows = [];
    try {
      if (useTabIndex) {
        // Treat sheetParam as an index (zero-based)
        const tabIndex = parseInt(sheetParam, 10);
        if (Number.isNaN(tabIndex)) {
          console.error(`[sheevy] Invalid tab index: ${sheetParam}`);
          return res.status(400).send(`Invalid tab index: ${sheetParam}`);
        }
        rows = await fetchSheetByIndex(spreadsheetId, tabIndex, authClient);
      } else {
        rows = await fetchEntireSheet(spreadsheetId, sheetParam, authClient);
      }
    } catch (error) {
      console.error(`[sheevy] Error fetching sheet data: ${error.message}`);
      return res.status(500).send(`Error fetching sheet data: ${error.message}`);
    }

    // Store in cache for 30 seconds
    memoryCache.put(
      cacheKey,
      rows,
      CACHE_TTL_MS,
      (key, value) => console.log(`[sheevy] Cache expired for key: ${key}`)
    );

    // Send CSV response
    if (raw) {
      return sendRawCsv(rows, res);
    } else {
      const headerRowParam = req.query.headerRow;
      const headerRow = headerRowParam ? parseInt(headerRowParam, 10) : 1;
      const allowNullableHeaders = req.query.allowNulableHeaders === '1';
      return sendCsv(rows, headerRow, res, allowNullableHeaders);
    }
  });

  // Start server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[sheevy] Server is listening on port ${port}`);
  });
})();

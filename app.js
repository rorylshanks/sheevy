#!/usr/bin/env node

/*
 * googleSheet.js
 *
 * This Node.js script reads two arguments from each line of STDIN (tab-separated):
 *    1) spreadsheetUrl  (the full Google Sheets URL)
 *    2) sheetName       (the tab name you want to read)
 *
 * It authenticates using a Google service account by reading credentials
 * from a JSON file on disk, then fetches data from the specified private
 * Google Sheet, and prints rows in TabSeparated format to STDOUT.
 *
 * Setup Requirements:
 *    1) Install dependencies:
 *         npm install googleapis
 *    2) Save your service account JSON key locally, for example: /path/to/google_creds.json
 *    3) Set an environment variable (or hardcode) the path to your JSON file:
 *         export GOOGLE_APPLICATION_CREDENTIALS="/path/to/google_creds.json"
 *
 * Usage in ClickHouse (after proper UDF config):
 *    SELECT *
 *    FROM googleSheet(
 *      'https://docs.google.com/spreadsheets/d/XXX/edit#gid=123456',
 *      'MyPrivateSheetTab'
 *    );
 */

const fs = require('fs');
const { google } = require('googleapis');
const readline = require('readline');

// Adjust this to wherever your JSON credentials file is stored
// or read from an environment variable:
const CREDS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || process.argv[2]
  || '/creds/google_creds.json';

/**
 * Extract the Google spreadsheet ID from its URL.
 * Example: "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=0"
 */
function parseSpreadsheetId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
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
    console.error(`Failed to read or parse credentials file at ${CREDS_PATH}: ${err.message}`);
    process.exit(1);
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
}

/**
 * Fetches rows from a given sheet range using the Google Sheets API.
 * The sheet range is: "sheetName!A1:Z1000" (adjust if needed).
 */
async function fetchSheetValues(spreadsheetId, sheetName, authClient) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const range = `${sheetName}!A1:Z1000`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  return res.data.values || [];
}

(async function main() {
  const authClient = await getAuthClient();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const [spreadsheetUrl, sheetName] = line.split('\t').map(s => s.trim());
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);

    if (!spreadsheetId) {
      console.error(`Could not parse spreadsheet ID from URL: ${spreadsheetUrl}`);
      process.exit(1);
    }

    let rows;
    try {
      rows = await fetchSheetValues(spreadsheetId, sheetName, authClient);
    } catch (err) {
      console.error(`Error fetching data: ${err.message}`);
      process.exit(1);
    }

    // Output each row in TabSeparated format.
    for (const rowData of rows) {
      const MAX_COLS = 100;
      const slice = rowData.slice(0, MAX_COLS);
      while (slice.length < MAX_COLS) {
        slice.push('');
      }
      console.log(slice.join('\t'));
    }
  }
})();

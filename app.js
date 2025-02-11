/**
 * Minimal Express.js application that serves *all* data from a specified Google Sheets tab as CSV.
 *
 * Install dependencies:
 *   npm install express googleapis
 *
 * Usage:
 *   1) Provide a service account JSON key either via an environment variable
 *      GOOGLE_APPLICATION_CREDENTIALS or by specifying a default path in the code.
 *   2) Run this app: node app.js
 *   3) Access the data at: http://localhost:3000/<SHEET_ID>/<SHEET_NAME>
 *
 * Example:
 *   http://localhost:3000/6QraRkfoEkZ9agMivOP_1uSD9Tm2GRngwkFfS5T-o-Uw/Sheet1
 *
 *   Returns all used data in "Sheet1" (the entire used range) from the given Google Sheet
 *   in CSV format. If the tab name has spaces, you might need URL-encoding or quotes in the route.
 */

const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');

// You can set this via an environment variable or hardcode a default path.
const CREDS_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || '/path/to/google_creds.json';

/**
 * Very naive CSV escaping. If your data has commas, quotes, line breaks, etc.
 * in cell values, you may want a more robust library.
 */
function toCsvLine(rowArray) {
  return rowArray
    .map((val = '') => {
      // Escape double quotes by doubling them
      const safe = String(val).replace(/"/g, '""');
      // Wrap fields containing commas or quotes in double quotes
      if (safe.indexOf('"') >= 0 || safe.indexOf(',') >= 0) {
        return `"${safe}"`;
      }
      return safe;
    })
    .join(',');
}

/**
 * Reads service account JSON from file and creates an authenticated Google client.
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
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/**
 * Fetches *all* used data from a given sheet. The API will automatically figure out
 * which cells/rows have data if we pass the sheet name only (A1 notation).
 */
async function fetchEntireSheet(spreadsheetId, sheetName, authClient) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  // By specifying the sheet's name only (e.g. "Sheet1"), 
  // the Sheets API returns all used data in that sheet.
  const range = sheetName;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  // returns a 2D array (rows of columns)
  return res.data.values || [];
}

(async function main() {
  const authClient = await getAuthClient();
  const app = express();

  /**
   * GET /:spreadsheetId/:sheetName
   * Example: /6QraRkfoEkZ9agMivOP_1uSD9Tm2GRngwkFfS5T-o-Uw/Sheet1
   */
  app.get('/:spreadsheetId/:sheetName', async (req, res) => {
    const { spreadsheetId, sheetName } = req.params;

    if (!spreadsheetId || !sheetName) {
      return res.status(400).send('Missing spreadsheetId or sheetName in URL path.');
    }

    try {
      const rows = await fetchEntireSheet(spreadsheetId, sheetName, authClient);
      // Convert each row to CSV
      const csvLines = rows.map(toCsvLine);
      const csvContent = csvLines.join('\n');

      // Send CSV
      res.type('text/csv');
      return res.send(csvContent);
    } catch (err) {
      console.error('Error fetching sheet data:', err);
      return res.status(500).send(`Error fetching sheet data: ${err.message}`);
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });
})();

<a name="readme-top"></a>

<div align="center">
<h3 align="center">Sheevy: Google Drive & Sheets CSV Passthrough Service</h3>

  <p align="center">
    A simple yet powerful API service to access CSV files and Google Sheets stored in Google Drive as CSV data via HTTP requests, with built-in support for integration with ClickHouse.
    <br />
    <br />
    <a href="https://github.com/your-repo/sheevy/issues">Report Bug</a>
    ·
    <a href="https://github.com/your-repo/sheevy/issues">Request Feature</a>
  </p>
</div>

<!-- ABOUT THE PROJECT -->
## About The Project

Sheevy provides a straightforward API to fetch data from CSV files and Google Sheets stored on Google Drive, returning results as CSV through HTTP requests. It simplifies integration for applications needing reliable CSV data retrieval and was originally designed for seamless querying via ClickHouse.

Key benefits of Sheevy include:

- **Flexible CSV Retrieval**  
  Easily fetch CSV data from Google Sheets and Drive-hosted files for use in any application.

- **Real-time Data Access**  
  Always access the latest available data directly from the source.

- **ClickHouse Compatibility**  
  Originally built for ClickHouse integration, Sheevy works seamlessly with its URL table function.

- **Simple Setup**  
  Minimal configuration and easy URL-based access simplify your workflow.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### 🚀 API Usage

#### Google Sheets API Endpoint
```
https://sheevy.your-domain.com/<Spreadsheet_ID>/<Sheet_Name>
```

- `<Spreadsheet_ID>`: Found in your Google Sheets URL after `/d/`.
- `<Sheet_Name>`: Name of your Google Sheets tab (URL-encoded).

#### Google Drive CSV API Endpoint
```
https://sheevy.your-domain.com/drive/<file_id>
```
- `<file_id>`: File ID from your Google Drive file URL (`/d/<file_id>`).

### 📌 Example Query (ClickHouse)
```sql
SELECT *
FROM url('https://sheevy.your-domain.com/<Spreadsheet_ID>/<Sheet_Name>', 'CSVWithNames')
```

### 🔑 Permissions

Your files must be shared with the Google service account used by Sheevy:
- Grant **viewer permissions** to Sheevy's service account email.

### 📦 Docker Compose Setup

To run Sheevy using Docker Compose:

```yaml
services:
  sheevy:
    image: rorylshanks/sheevy:latest
    environment:
      GOOGLE_APPLICATION_CREDENTIALS: /path/to/google-credentials.json
    volumes:
      - ./path/to/credentials.json:/path/to/google-credentials.json
    ports:
      - 3000:3000
```

Place your Google credentials file (`credentials.json`) in the specified location and run:

```bash
docker-compose up
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SPECIAL URL OPTIONS -->
## ✨ Special URL Options for Google Sheets

Customize your API responses with these URL parameters:

- `headerRow=N`: Specify a different header row (default is 1).
  - Example: `?headerRow=2`
- `raw=1`: Auto-generate headers if no clear header row exists.
  - Example: `?raw=1`
- `useTabIndex=1`: Use numeric tab index (starting from 0).
  - Example: `?useTabIndex=1`

#### Combined URL Options Example
```
https://sheevy.your-domain.com/<Spreadsheet_ID>/0?useTabIndex=1&raw=1
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

We welcome contributions!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/YourFeature`)
3. Commit your Changes (`git commit -m 'Add YourFeature'`)
4. Push to the Branch (`git push origin feature/YourFeature`)
5. Open a Pull Request

Or open an issue labeled "enhancement" or "bug" to discuss improvements.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>


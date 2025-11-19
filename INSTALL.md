# Installation

This guide explains how to set up the **crystal-designer** project locally.

## Prerequisites

- Python 3.9+ (tested with Python 3.11).
- pip and virtualenv (recommended).

The front‑end is static HTML/JS and does **not** require Node.js; any static server will work.

## Clone the repository

```bash
git clone https://github.com/alexanderholman/crystal-designer.git
cd crystal-designer
```

## Set up the backend environment

Create a virtual environment and install the Python dependencies:

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r backend/requirements.txt
```

## Run the backend server

From the `backend` directory, start the FastAPI server with uvicorn:

```bash
cd backend
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

This serves the API at `http://localhost:8000`. The `--reload` flag watches for file changes and restarts the server automatically.

## Serve the front‑end

The front‑end lives in the `frontend` directory. You can serve it with any simple HTTP server. For example, using Python:

```bash
cd frontend
python -m http.server 5500
```

Then open your browser to `http://localhost:5500/index.html`.

Alternatively, you can open `index.html` directly in your browser, but using a simple server avoids cross‑origin request issues.

## Configuration

The default configuration is stored in `backend/design.yaml`. The front‑end fetches this configuration via the API. You can edit the YAML file directly or use the front‑end controls to modify the crystal; configuration changes are saved back to this file via the API.

## Troubleshooting

- If you modify Python dependencies, restart the backend server.
- The front‑end expects the API to be available at `http://localhost:8000`. Ensure the backend is running and accessible.
- For production deployment, configure CORS and adjust host/port settings as needed.

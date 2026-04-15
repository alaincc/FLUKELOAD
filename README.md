# Fluke 3540 FC Load Calculation App

A small local app for parsing Fluke 3540 FC `.fel` sessions with FastAPI and exploring the sampled data from a Next.js frontend.

## Structure

- `backend/`: FastAPI API that parses `.fel` files server-side.
- `frontend/`: Next.js app that uploads `.fel` files and graphs parsed data.
- `backend/tests/`: minimal regression tests for the parser and API.

## Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Runs on `http://127.0.0.1:8000`.

Run the backend tests with:

```bash
cd backend
python3 -m unittest discover -s tests
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://127.0.0.1:3000`.

The frontend defaults to `http://127.0.0.1:8000` for the API, but you can override it with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

## Flow

1. Open the Next.js app.
2. Upload a `.fel` file.
3. The frontend sends it to FastAPI.
4. FastAPI samples and parses known load-calculation fields.
5. The frontend renders currents, kW, and frequency in separate charts.

## Current Status

- The core upload -> parse -> chart flow is implemented.
- The parser field map still includes some inferred metrics marked with `low` or `medium` confidence.
- Full end-to-end verification still requires installing Python and Node dependencies in the target environment.

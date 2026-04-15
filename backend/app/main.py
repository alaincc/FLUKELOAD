from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, Union

from pydantic import BaseModel
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .parser import parse_fel_file


app = FastAPI(title="Fluke 3540 FC Parser API")
IS_VERCEL = os.environ.get("VERCEL") == "1"
DATA_ROOT = Path(os.environ.get("FLUKE_DATA_ROOT") or ("/tmp/flukeload" if IS_VERCEL else Path(__file__).resolve().parents[1] / "data"))
CACHE_DIR = DATA_ROOT / "saved_sessions"
UPLOAD_TMP_DIR = DATA_ROOT / "tmp_uploads"
EXPORTS_DIR = DATA_ROOT / "client_exports"
COMPANY_LOGO_PATH = Path("/Users/alaincc/Documents/eco_logo.jpg")
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://flukeload.vercel.app",
]
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", ",".join(DEFAULT_ALLOWED_ORIGINS)).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


def ensure_cache_dir() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR


def ensure_upload_tmp_dir() -> Path:
    UPLOAD_TMP_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_TMP_DIR


def ensure_exports_dir() -> Path:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return EXPORTS_DIR


ensure_upload_tmp_dir()
tempfile.tempdir = str(UPLOAD_TMP_DIR)


def build_session_id(file_sha256: str, sample_step: int, max_points: int) -> str:
    return f"{file_sha256}-s{sample_step}-m{max_points}"


def session_path(session_id: str) -> Path:
    return ensure_cache_dir() / f"{session_id}.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value.strip())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "client-export"


def build_saved_session(
    *,
    session_id: str,
    original_filename: str,
    file_sha256: str,
    sample_step: int,
    max_points: int,
    cached_at_utc: str,
    cache_hit: bool,
) -> dict:
    return {
        "id": session_id,
        "original_filename": original_filename,
        "file_sha256": file_sha256,
        "sample_step": sample_step,
        "max_points": max_points,
        "cached_at_utc": cached_at_utc,
        "cache_hit": cache_hit,
    }


def load_session_payload(path: Path) -> dict:
    return json.loads(path.read_text())


def store_session_payload(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload))


def session_summary(payload: dict) -> dict:
    saved = payload["saved_session"]
    meta = payload["meta"]
    return {
        "id": saved["id"],
        "original_filename": saved["original_filename"],
        "file_sha256": saved["file_sha256"],
        "sample_step": saved["sample_step"],
        "max_points": saved["max_points"],
        "cached_at_utc": saved["cached_at_utc"],
        "record_count": meta["record_count"],
        "plotted_points": meta["plotted_points"],
        "first_record_start": meta["first_record_start"],
        "last_record_end": meta["last_record_end"],
        "study_start_at": meta.get("study_start_at"),
        "study_end_at": meta.get("study_end_at"),
    }


def locate_config_file(original_filename: str) -> Optional[Path]:
    config_name = f"{Path(original_filename).stem}-config.json"
    matches = list(Path(__file__).resolve().parents[2].rglob(config_name))
    if len(matches) == 1:
        return matches[0]
    return None


def locate_study_profile_file(original_filename: str) -> Optional[Path]:
    profile_name = f"{Path(original_filename).stem}-study.json"
    matches = list(Path(__file__).resolve().parents[2].rglob(profile_name))
    if len(matches) == 1:
        return matches[0]
    return None


def epoch_millis_to_iso(value: Optional[Union[int, float]]) -> Optional[str]:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError, TypeError):
        return None


def config_study_period(original_filename: str) -> Tuple[Optional[str], Optional[str]]:
    config_path = locate_config_file(original_filename)
    if config_path is None:
        return None, None

    try:
        payload = json.loads(config_path.read_text())
    except json.JSONDecodeError:
        return None, None

    timing = payload.get("session_timing", {})
    return (
        epoch_millis_to_iso(timing.get("session_start_at")),
        epoch_millis_to_iso(timing.get("session_end_at")),
    )


def load_study_profile(original_filename: str) -> Optional[dict]:
    profile_path = locate_study_profile_file(original_filename)
    if profile_path is None:
        return None

    try:
        payload = json.loads(profile_path.read_text())
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def enrich_payload_with_study_context(payload: dict, original_filename: str) -> Tuple[dict, bool]:
    changed = False
    meta = payload.setdefault("meta", {})
    if meta.get("study_start_at") and meta.get("study_end_at"):
        pass
    else:
        study_start_at, study_end_at = config_study_period(original_filename)
        if study_start_at and meta.get("study_start_at") != study_start_at:
            meta["study_start_at"] = study_start_at
            changed = True
        if study_end_at and meta.get("study_end_at") != study_end_at:
            meta["study_end_at"] = study_end_at
            changed = True

    if not payload.get("study_profile"):
        profile = load_study_profile(original_filename)
        if profile:
            payload["study_profile"] = profile
            changed = True

    return payload, changed


def require_session_path(session_id: str) -> Path:
    path = session_path(session_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Saved session not found")
    return path


class RenameSavedSessionRequest(BaseModel):
    original_filename: str


class ClientExportRequest(BaseModel):
    dashboard_html: str
    report_html: str
    analysis_payload: dict
    client_name: str
    site_address: str
    export_label: Optional[str] = None


@app.get("/api/saved-sessions")
def list_saved_sessions() -> dict:
    sessions = []
    for path in ensure_cache_dir().glob("*.json"):
        payload = load_session_payload(path)
        sessions.append(session_summary(payload))
    sessions.sort(key=lambda item: item["cached_at_utc"], reverse=True)
    return {"sessions": sessions}


@app.get("/api/saved-sessions/{session_id}")
def get_saved_session(session_id: str) -> dict:
    path = require_session_path(session_id)
    payload = load_session_payload(path)
    payload, changed = enrich_payload_with_study_context(
        payload,
        payload.get("saved_session", {}).get("original_filename", "upload.fel"),
    )
    if changed:
        store_session_payload(path, payload)
    response = deepcopy(payload)
    response["saved_session"]["cache_hit"] = True
    return response


@app.patch("/api/saved-sessions/{session_id}")
def rename_saved_session(session_id: str, request: RenameSavedSessionRequest) -> dict:
    next_name = request.original_filename.strip()
    if not next_name:
        raise HTTPException(status_code=400, detail="original_filename must not be empty")

    path = require_session_path(session_id)
    payload = load_session_payload(path)
    payload["saved_session"]["original_filename"] = next_name
    store_session_payload(path, payload)
    return session_summary(payload)


@app.delete("/api/saved-sessions/{session_id}")
def delete_saved_session(session_id: str) -> dict:
    path = require_session_path(session_id)
    path.unlink()
    return {"ok": True}


@app.post("/api/parse-fel")
async def parse_fel(
    file: UploadFile = File(...),
    sample_step: int = Form(30),
    max_points: int = Form(8000),
) -> dict:
    if sample_step < 1:
        raise HTTPException(status_code=400, detail="sample_step must be at least 1")
    if max_points < 1:
        raise HTTPException(status_code=400, detail="max_points must be at least 1")

    suffix = Path(file.filename or "upload.fel").suffix.lower()
    if suffix != ".fel":
        raise HTTPException(status_code=400, detail="Expected a .fel file")

    try:
        digest = hashlib.sha256()
        with tempfile.NamedTemporaryFile(
            delete=False,
            dir=ensure_upload_tmp_dir(),
            suffix=".fel",
        ) as temp:
            temp_path = Path(temp.name)
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                temp.write(chunk)
        file_sha256 = digest.hexdigest()
        session_id = build_session_id(file_sha256, sample_step, max_points)
        path = session_path(session_id)
        original_filename = file.filename or "upload.fel"

        if path.exists():
            payload = load_session_payload(path)
            payload, changed = enrich_payload_with_study_context(payload, original_filename)
            if changed:
                store_session_payload(path, payload)
            response = deepcopy(payload)
            response["saved_session"]["cache_hit"] = True
            return response

        payload = parse_fel_file(temp_path, sample_step=sample_step, max_points=max_points)
        payload, _ = enrich_payload_with_study_context(payload, original_filename)
        payload["saved_session"] = build_saved_session(
            session_id=session_id,
            original_filename=original_filename,
            file_sha256=file_sha256,
            sample_step=sample_step,
            max_points=max_points,
            cached_at_utc=utc_now_iso(),
            cache_hit=False,
        )
        store_session_payload(path, payload)
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except UnboundLocalError:
            pass


def try_generate_pdf_from_html(source_html: Path, target_pdf: Path) -> tuple[bool, str | None]:
    chrome_candidates = [
        "google-chrome",
        "chromium",
        "chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]

    for candidate in chrome_candidates:
        executable = candidate if Path(candidate).exists() else shutil.which(candidate)
        if not executable:
            continue

        command = [
            executable,
            "--headless=new",
            "--disable-gpu",
            f"--print-to-pdf={target_pdf}",
            source_html.resolve().as_uri(),
        ]
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode == 0 and target_pdf.exists():
            return True, None

        fallback_command = [
            executable,
            "--headless",
            "--disable-gpu",
            f"--print-to-pdf={target_pdf}",
            source_html.resolve().as_uri(),
        ]
        completed = subprocess.run(fallback_command, capture_output=True, text=True)
        if completed.returncode == 0 and target_pdf.exists():
            return True, None

        stderr = completed.stderr.strip() or completed.stdout.strip() or "unknown PDF rendering error"
        return False, stderr

    return False, "Chrome/Chromium headless renderer is not installed"


@app.post("/api/client-exports")
def create_client_export(request: ClientExportRequest) -> dict:
    generated_at = datetime.now(timezone.utc)
    timestamp = generated_at.strftime("%Y%m%d-%H%M%S")
    saved_session = request.analysis_payload.get("saved_session", {})
    original_name = saved_session.get("original_filename") or "session"
    label_source = request.export_label or request.client_name or Path(original_name).stem
    export_dir = ensure_exports_dir() / f"{timestamp}-{slugify(label_source)}"
    export_dir.mkdir(parents=True, exist_ok=True)

    dashboard_path = export_dir / "dashboard.html"
    report_path = export_dir / "report.html"
    session_path_out = export_dir / "analysis.json"
    manifest_path = export_dir / "manifest.json"
    pdf_path = export_dir / "report.pdf"
    logo_path_out = export_dir / "eco_logo.jpg"

    dashboard_path.write_text(request.dashboard_html, encoding="utf-8")
    report_path.write_text(request.report_html, encoding="utf-8")
    session_path_out.write_text(json.dumps(request.analysis_payload, indent=2), encoding="utf-8")
    logo_copied = False
    if COMPANY_LOGO_PATH.exists():
        shutil.copy2(COMPANY_LOGO_PATH, logo_path_out)
        logo_copied = True

    pdf_generated, pdf_error = try_generate_pdf_from_html(report_path, pdf_path)
    if not pdf_generated and pdf_path.exists():
        pdf_path.unlink()

    manifest = {
        "generated_at_utc": generated_at.isoformat(),
        "client_name": request.client_name,
        "site_address": request.site_address,
        "export_directory": str(export_dir),
        "source_session_id": saved_session.get("id"),
        "source_filename": original_name,
        "files": {
            "dashboard_html": str(dashboard_path),
            "report_html": str(report_path),
            "analysis_json": str(session_path_out),
            "report_pdf": str(pdf_path) if pdf_generated else None,
            "company_logo": str(logo_path_out) if logo_copied else None,
        },
        "pdf_generated": pdf_generated,
        "pdf_error": pdf_error,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return manifest

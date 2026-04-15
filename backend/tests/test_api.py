from pathlib import Path
import tempfile
import unittest
from typing import Tuple

from fastapi.testclient import TestClient

from app import main as main_module
from app.main import app


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_FEL = ROOT / "48274031" / "sessions" / "LS.035.fel"


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir=ROOT / "backend")
        self.original_cache_dir = main_module.CACHE_DIR
        self.original_upload_tmp_dir = main_module.UPLOAD_TMP_DIR
        self.original_exports_dir = main_module.EXPORTS_DIR
        self.original_tempdir = tempfile.tempdir
        main_module.CACHE_DIR = Path(self.temp_dir.name)
        main_module.UPLOAD_TMP_DIR = Path(self.temp_dir.name) / "uploads"
        main_module.EXPORTS_DIR = Path(self.temp_dir.name) / "exports"
        main_module.UPLOAD_TMP_DIR.mkdir(parents=True, exist_ok=True)
        tempfile.tempdir = str(main_module.UPLOAD_TMP_DIR)

    def tearDown(self) -> None:
        main_module.CACHE_DIR = self.original_cache_dir
        main_module.UPLOAD_TMP_DIR = self.original_upload_tmp_dir
        main_module.EXPORTS_DIR = self.original_exports_dir
        tempfile.tempdir = self.original_tempdir
        self.temp_dir.cleanup()

    @staticmethod
    def sample_file_part() -> Tuple[str, bytes, str]:
        return ("LS.035.fel", SAMPLE_FEL.read_bytes(), "application/octet-stream")

    def test_health_endpoint(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_parse_endpoint_rejects_invalid_sample_step(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "0", "max_points": "10"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "sample_step must be at least 1")

    def test_parse_endpoint_accepts_valid_file(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "1000", "max_points": "3"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["meta"]["plotted_points"], 3)
        self.assertEqual(len(payload["rows"]), 3)
        self.assertEqual(payload["saved_session"]["original_filename"], "LS.035.fel")
        self.assertFalse(payload["saved_session"]["cache_hit"])
        self.assertEqual(payload["meta"]["study_start_at"], "2026-03-24T17:04:55.188000+00:00")
        self.assertEqual(payload["meta"]["study_end_at"], "2026-04-01T20:49:15.162000+00:00")
        self.assertEqual(payload["study_profile"]["panel"]["brand"], "Siemens")
        self.assertEqual(payload["study_profile"]["load_study"]["asset"], "SWBD.A")

    def test_parse_endpoint_reuses_saved_payload_for_same_file_and_options(self) -> None:
        with TestClient(app) as client:
            first = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "1000", "max_points": "3"},
            )
            second = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "1000", "max_points": "3"},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(first.json()["saved_session"]["cache_hit"])
        self.assertTrue(second.json()["saved_session"]["cache_hit"])

    def test_saved_sessions_can_be_listed_and_loaded(self) -> None:
        with TestClient(app) as client:
            parsed = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "500", "max_points": "5"},
            )
            session_id = parsed.json()["saved_session"]["id"]

            listed = client.get("/api/saved-sessions")
            loaded = client.get(f"/api/saved-sessions/{session_id}")

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["sessions"]), 1)
        self.assertEqual(listed.json()["sessions"][0]["id"], session_id)
        self.assertEqual(loaded.status_code, 200)
        self.assertTrue(loaded.json()["saved_session"]["cache_hit"])
        self.assertEqual(loaded.json()["meta"]["plotted_points"], 5)
        self.assertEqual(loaded.json()["study_profile"]["observations"]["panel_configuration"], "Main Lug Panel (MLP)")

    def test_saved_session_can_be_renamed(self) -> None:
        with TestClient(app) as client:
            parsed = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "500", "max_points": "5"},
            )
            session_id = parsed.json()["saved_session"]["id"]

            renamed = client.patch(
                f"/api/saved-sessions/{session_id}",
                json={"original_filename": "Mi sesion favorita.fel"},
            )
            listed = client.get("/api/saved-sessions")

        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["original_filename"], "Mi sesion favorita.fel")
        self.assertEqual(listed.json()["sessions"][0]["original_filename"], "Mi sesion favorita.fel")

    def test_saved_session_can_be_deleted(self) -> None:
        with TestClient(app) as client:
            parsed = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "500", "max_points": "5"},
            )
            session_id = parsed.json()["saved_session"]["id"]

            deleted = client.delete(f"/api/saved-sessions/{session_id}")
            listed = client.get("/api/saved-sessions")
            loaded = client.get(f"/api/saved-sessions/{session_id}")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"ok": True})
        self.assertEqual(listed.json()["sessions"], [])
        self.assertEqual(loaded.status_code, 404)

    def test_client_export_generates_dashboard_package(self) -> None:
        with TestClient(app) as client:
            parsed = client.post(
                "/api/parse-fel",
                files={"file": self.sample_file_part()},
                data={"sample_step": "1000", "max_points": "3"},
            )
            payload = parsed.json()

            exported = client.post(
                "/api/client-exports",
                json={
                    "dashboard_html": "<html><body><h1>Dashboard</h1></body></html>",
                    "report_html": "<html><body><h1>Report</h1></body></html>",
                    "analysis_payload": payload,
                    "client_name": "Cliente Demo",
                    "site_address": "123 Main St",
                    "export_label": "Entrega Demo",
                },
            )

        self.assertEqual(exported.status_code, 200)
        manifest = exported.json()
        export_dir = Path(manifest["export_directory"])
        self.assertTrue(export_dir.exists())
        self.assertTrue((export_dir / "dashboard.html").exists())
        self.assertTrue((export_dir / "report.html").exists())
        self.assertTrue((export_dir / "analysis.json").exists())
        self.assertTrue((export_dir / "manifest.json").exists())
        self.assertFalse(manifest["pdf_generated"])
        self.assertIsInstance(manifest["pdf_error"], str)
        self.assertTrue(manifest["pdf_error"])


if __name__ == "__main__":
    unittest.main()

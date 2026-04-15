from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


DEFAULT_LOGO = Path("/Users/alaincc/Documents/eco_logo.jpg")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a static GitHub Pages package from a generated client export.",
    )
    parser.add_argument("export_dir", type=Path, help="Path to the generated client export folder")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("github-pages-site"),
        help="Output directory for the GitHub Pages package",
    )
    parser.add_argument(
        "--site-title",
        default="Client Dashboard",
        help="Display title for the package landing page",
    )
    return parser.parse_args()


def ensure_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing {label}: {path}")


def build_root_index(site_title: str, export_name: str) -> str:
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{site_title}</title>
    <style>
      body {{
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #f7f2ea 0%, #efe5d8 100%);
        color: #2b241a;
      }}
      main {{
        width: min(900px, calc(100vw - 32px));
        margin: 48px auto;
        background: rgba(255,250,241,0.95);
        border: 1px solid rgba(81,61,31,0.14);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 24px 60px rgba(66,51,30,0.12);
      }}
      a {{
        color: #2b241a;
      }}
      .actions {{
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 18px;
      }}
      .button {{
        display: inline-block;
        text-decoration: none;
        border: 1px solid rgba(160,63,50,0.2);
        border-radius: 999px;
        padding: 12px 16px;
        background: rgba(255,250,241,0.85);
      }}
    </style>
  </head>
  <body>
    <main>
      <p style="text-transform:uppercase;letter-spacing:.18em;font-size:11px;color:#a03f32;margin:0 0 8px;">GitHub Pages</p>
      <h1 style="margin:0 0 12px;">{site_title}</h1>
      <p style="margin:0;color:#6f5e42;">Static package generated from export <strong>{export_name}</strong>.</p>
      <div class="actions">
        <a class="button" href="./index.html">Open Dashboard</a>
        <a class="button" href="./report.html">Open Report</a>
        <a class="button" href="./analysis.json">Download Analysis JSON</a>
      </div>
    </main>
  </body>
</html>
"""


def build_readme(package_dir: Path) -> str:
    return f"""# GitHub Pages Package

This folder is ready to publish with GitHub Pages.

Files:
- `index.html`: client dashboard
- `report.html`: client report
- `analysis.json`: parsed analysis payload
- `eco_logo.jpg`: company logo
- `.nojekyll`: disables Jekyll processing on GitHub Pages

Publish steps:
1. Create or open a GitHub repository.
2. Upload the contents of this folder to the repository root, or to a `docs/` folder.
3. In GitHub, go to `Settings > Pages`.
4. Select the branch and folder where you uploaded these files.
5. Save, then open the generated GitHub Pages URL.

Package path:
`{package_dir}`
"""


def main() -> None:
    args = parse_args()
    export_dir = args.export_dir.resolve()
    output_dir = args.output_dir.resolve()

    ensure_file(export_dir / "dashboard.html", "dashboard.html")
    ensure_file(export_dir / "report.html", "report.html")
    ensure_file(export_dir / "analysis.json", "analysis.json")

    output_dir.mkdir(parents=True, exist_ok=True)

    dashboard_src = export_dir / "dashboard.html"
    report_src = export_dir / "report.html"
    analysis_src = export_dir / "analysis.json"
    logo_src = export_dir / "eco_logo.jpg"
    if not logo_src.exists() and DEFAULT_LOGO.exists():
      shutil.copy2(DEFAULT_LOGO, export_dir / "eco_logo.jpg")
      logo_src = export_dir / "eco_logo.jpg"

    shutil.copy2(dashboard_src, output_dir / "index.html")
    shutil.copy2(report_src, output_dir / "report.html")
    shutil.copy2(analysis_src, output_dir / "analysis.json")

    if logo_src.exists():
        shutil.copy2(logo_src, output_dir / "eco_logo.jpg")

    (output_dir / ".nojekyll").write_text("")
    (output_dir / "README.md").write_text(build_readme(output_dir))

    manifest_path = export_dir / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest["github_pages_package"] = str(output_dir)
    manifest_path.write_text(json.dumps(manifest, indent=2))

    print(output_dir)


if __name__ == "__main__":
    main()

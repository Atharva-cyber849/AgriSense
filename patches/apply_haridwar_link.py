from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
index_path = repo_root / "index.html"

if not index_path.exists():
    raise SystemExit(f"index.html not found at {index_path}")

text = index_path.read_text(encoding="utf-8")

marker = """    <div class="header-right">
      <!-- Persona Switcher -->"""

insert = """    <div class="header-right">
      <a class="btn btn-outline" href="haridwar.html" title="Open Haridwar wheat phenology research dashboard">
        <i data-lucide="flask-conical"></i> Haridwar Research
      </a>

      <!-- Persona Switcher -->"""

if 'href="haridwar.html"' in text:
    print("Haridwar link already exists in index.html; no change needed.")
elif marker not in text:
    raise SystemExit(
        "Could not find the expected header-right marker in index.html. "
        "Use add-haridwar-link.patch or add the Haridwar link manually."
    )
else:
    index_path.write_text(
        text.replace(marker, insert, 1),
        encoding="utf-8"
    )
    print("Updated index.html with the Haridwar Research link.")

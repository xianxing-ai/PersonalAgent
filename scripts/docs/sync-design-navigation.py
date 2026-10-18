"""Compatibility entry: emit current architecture navigation patches; no writes."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[2]
result = subprocess.run(["node", str(root / "scripts/docs/sync-workflow-navigation.mjs"), *sys.argv[1:]], cwd=root)
sys.exit(result.returncode)

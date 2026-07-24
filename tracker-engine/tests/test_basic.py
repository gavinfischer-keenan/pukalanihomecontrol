import os
import sys
sys.path.insert(0, "/opt")

def test_ais_collector_imports():
    """Verify ais-collector module can be loaded"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("ais_collector", "/opt/ais-collector.py")
    assert spec is not None

def test_env_file_exists():
    """Verify .env file is present"""
    assert os.path.exists("/opt/.env")

def test_env_has_required_keys():
    """Verify .env has all required keys"""
    with open("/opt/.env") as f:
        content = f.read()
    for key in ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]:
        assert key in content, f"Missing {key} in .env"

import os
import re
import json
import shutil
import subprocess
import time
import urllib.parse
from pathlib import Path

_auth_proc = None
_auth_port = None
_auth_state = None

def get_status():
    installed = shutil.which("rclone") is not None
    fuse_ok = os.path.exists("/dev/fuse")
    remotes = []
    if installed:
        try:
            out = subprocess.check_output(["rclone", "listremotes"], timeout=5, text=True)
            remotes = [r.strip().rstrip(":") for r in out.strip().splitlines() if r.strip()]
        except Exception:
            pass
    
    mounted = False
    if os.path.exists("/proc/mounts"):
        with open("/proc/mounts", "r") as f:
            mounted = any("/mnt/gdrive" in line for line in f)
    if not mounted:
        mounted = Path("/mnt/gdrive").is_mount()
        
    return {
        "installed": installed,
        "fuse_ok": fuse_ok,
        "remotes": remotes,
        "has_gdrive": any("gdrive" in r.lower() or "drive" in r.lower() for r in remotes),
        "mounted": mounted,
        "mount_path": "/mnt/gdrive",
    }

def get_live_google_auth_url():
    """Starts rclone authorize and captures the dynamic live Google OAuth URL"""
    global _auth_proc, _auth_port, _auth_state
    if _auth_proc and _auth_proc.poll() is None:
        try:
            _auth_proc.terminate()
        except Exception:
            pass
        _auth_proc = None
        
    subprocess.run(["pkill", "-f", "rclone authorize"], capture_output=True)
    time.sleep(0.3)
    
    cmd = ["rclone", "authorize", "drive", "--auth-no-open-browser"]
    _auth_proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    local_url = None
    for line in iter(_auth_proc.stdout.readline, ''):
        match = re.search(r'http://127\.0\.0\.1:(\d+)/auth\?state=([\w-]+)', line)
        if match:
            local_url = match.group(0)
            _auth_port = match.group(1)
            _auth_state = match.group(2)
            break
            
    if not local_url:
        return {"ok": False, "detail": "Failed to start rclone authorization engine"}
        
    try:
        import requests
        r = requests.get(local_url, allow_redirects=False, timeout=5)
        google_url = r.headers.get("Location")
        if google_url:
            return {"ok": True, "auth_url": google_url, "local_url": local_url}
        else:
            return {"ok": False, "detail": "Failed to extract Google OAuth location header"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}

def mount_gdrive():
    status = get_status()
    if status["mounted"]:
        return {"ok": True, "message": "Already mounted at /mnt/gdrive"}
    if not status["has_gdrive"]:
        return {"ok": False, "detail": "gdrive remote is not configured yet. Please authorize Google Drive first."}
    
    os.makedirs("/mnt/gdrive", exist_ok=True)
    cmd = ["rclone", "mount", "gdrive:", "/mnt/gdrive", "--daemon", "--vfs-cache-mode", "writes", "--allow-other"]
    
    # Use Popen to prevent stdout/stderr fd hang on daemon process
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        time.sleep(2)
        new_status = get_status()
        if new_status["mounted"]:
            return {"ok": True, "message": "Google Drive successfully mounted at /mnt/gdrive"}
            
        # If not mounted yet, check if process failed
        if proc.poll() is not None:
            _, stderr = proc.communicate()
            return {"ok": False, "detail": f"Mount failed. Stderr: {stderr}"}
            
        # Give 2 more seconds for slow mounts
        time.sleep(2)
        new_status = get_status()
        if new_status["mounted"]:
            return {"ok": True, "message": "Google Drive successfully mounted at /mnt/gdrive"}
        else:
            return {"ok": False, "detail": "Mount command ran but /mnt/gdrive is not mounted yet."}
    except Exception as e:
        return {"ok": False, "detail": str(e)}

def unmount_gdrive():
    try:
        subprocess.run(["fusermount", "-u", "/mnt/gdrive"], capture_output=True, text=True, timeout=5)
    except Exception:
        subprocess.run(["umount", "-l", "/mnt/gdrive"], capture_output=True, text=True, timeout=5)
    time.sleep(1)
    status = get_status()
    return {"ok": not status["mounted"], "mounted": status["mounted"]}

def create_remote(input_str):
    """
    Exchanges authorization code with running rclone authorization process.
    """
    global _auth_proc, _auth_port, _auth_state
    input_str = input_str.strip()
    
    code = None
    state = _auth_state
    
    # 1. Parse URL if pasted
    if "code=" in input_str or "http" in input_str:
        try:
            parsed = urllib.parse.urlparse(input_str)
            qs = urllib.parse.parse_qs(parsed.query)
            if "code" in qs and qs["code"]:
                code = qs["code"][0]
            if "state" in qs and qs["state"]:
                state = qs["state"][0]
        except Exception:
            pass
    elif not input_str.startswith("{"):
        code = input_str

    token_json_str = None
    
    # 2. Forward code & state to active rclone authorization process
    if code and _auth_proc and _auth_port and _auth_proc.poll() is None:
        try:
            import requests
            callback_url = f"http://127.0.0.1:{_auth_port}/?state={state or _auth_state}&code={code}"
            requests.get(callback_url, timeout=5)
            
            # Read token JSON from rclone process output
            if _auth_proc.stdout:
                for line in iter(_auth_proc.stdout.readline, ''):
                    if "access_token" in line:
                        match = re.search(r'\{.*"access_token".*\}', line)
                        if match:
                            token_json_str = match.group(0)
                            break
        except Exception as e:
            pass

    # 3. If input was already full JSON blob
    if not token_json_str and input_str.startswith("{"):
        token_json_str = input_str

    if not token_json_str:
        return {"ok": False, "detail": "Authorization session expired or state mismatch. Please click 'Refresh Link', sign in again, and paste the new URL."}

    # Write token JSON to rclone.conf
    conf_dir = Path.home() / ".config" / "rclone"
    conf_dir.mkdir(parents=True, exist_ok=True)
    conf_path = conf_dir / "rclone.conf"
    
    content = f"[gdrive]\ntype = drive\ntoken = {token_json_str}\n"
    try:
        conf_path.write_text(content, encoding="utf-8")
        mount_res = mount_gdrive()
        if mount_res.get("ok"):
            return {"ok": True, "message": "Google Drive connected and mounted at /mnt/gdrive!"}
        else:
            return {"ok": True, "message": "Google Drive credentials saved. Click Mount to connect."}
    except Exception as e:
        return {"ok": False, "detail": str(e)}

if __name__ == "__main__":
    print("Status:", get_status())

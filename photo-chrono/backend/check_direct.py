import subprocess

cmd = ["rclone", "mount", "gdrive:", "/mnt/gdrive", "--vfs-cache-mode", "writes", "--allow-other"]
try:
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
    print("STDOUT:", res.stdout)
    print("STDERR:", res.stderr)
except subprocess.TimeoutExpired as e:
    print("TIMEOUT EXPIRED (means mount stayed active in foreground!):", e)
    if e.stdout: print("STDOUT:", e.stdout.decode())
    if e.stderr: print("STDERR:", e.stderr.decode())

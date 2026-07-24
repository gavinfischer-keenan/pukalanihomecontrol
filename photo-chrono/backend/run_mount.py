import sys
sys.path.insert(0, "/app/photo-chrono/backend")
import rclone_mgr

res = rclone_mgr.mount_gdrive()
print("MOUNT RESULT:", res)

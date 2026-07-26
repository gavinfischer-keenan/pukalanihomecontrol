#!/usr/bin/env python3
"""
DB Growth Monitor — runs daily at 4 AM via cron.
Logs table sizes, row counts, and index health to /var/log/db-growth.log.
Alerts if growth rate is abnormal or indexes are bloated.
"""
import subprocess
import datetime
import json
import os

LOG_FILE = "/var/log/db-growth.log"
ALERT_THRESHOLD_MB_PER_DAY = 100
INDEX_BLOAT_MIN_MB = 10  # Only alert on index bloat if index > 10MB

def run_sql(sql, db="tracking_db"):
    cmd = f'pct exec 104 -- su - postgres -c "psql -d {db} -t -A -F, -c \\"{sql}\\""'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    return r.stdout.strip()

now = datetime.datetime.now().isoformat()
report = {"timestamp": now, "tables": {}, "totals": {}, "alerts": []}

# Total DB size
total_size = run_sql("SELECT pg_database_size('tracking_db');")
report["totals"]["db_size_bytes"] = int(total_size) if total_size.isdigit() else 0
report["totals"]["db_size_mb"] = round(report["totals"]["db_size_bytes"] / 1024 / 1024, 1)

# Per-table stats (correct table names)
for table in ["entity_track_history", "live_tracks", "entities",
              "vessel_sightings", "aircraft_sightings", "vessel_info"]:
    try:
        row_count = run_sql(f"SELECT count(*) FROM {table};")
        table_size = run_sql(f"SELECT pg_total_relation_size('{table}');")
        index_size = run_sql(f"SELECT pg_indexes_size('{table}');")
        
        tbl_bytes = int(table_size) if table_size.isdigit() else 0
        idx_bytes = int(index_size) if index_size.isdigit() else 0
        
        report["tables"][table] = {
            "rows": int(row_count) if row_count.isdigit() else 0,
            "total_mb": round(tbl_bytes / 1024 / 1024, 1),
            "index_mb": round(idx_bytes / 1024 / 1024, 1),
        }
        
        # Index bloat check (only meaningful for tables > 10MB index)
        tbl_data = tbl_bytes - idx_bytes
        if idx_bytes > INDEX_BLOAT_MIN_MB * 1024 * 1024 and tbl_data > 0:
            ratio = idx_bytes / tbl_data
            if ratio > 3.0:
                report["alerts"].append(
                    f"INDEX BLOAT: {table} index ({round(idx_bytes/1024/1024,1)}MB) "
                    f"is {round(ratio,1)}x table data — consider REINDEX"
                )
    except:
        pass

# Statement timeout errors (last 24h)
try:
    timeout_errors = subprocess.run(
        'pct exec 105 -- journalctl -u ais-collector --since "24 hours ago" --no-pager 2>/dev/null | grep -c "statement timeout"',
        shell=True, capture_output=True, text=True, timeout=15
    ).stdout.strip()
    timeout_count = int(timeout_errors) if timeout_errors.isdigit() else 0
    report["totals"]["statement_timeouts_24h"] = timeout_count
    if timeout_count > 10:
        report["alerts"].append(
            f"DB TIMEOUTS: {timeout_count} statement_timeout errors in last 24h"
        )
except:
    timeout_count = -1

# Growth rate vs previous
prev_report = None
if os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'r') as f:
        for line in reversed(f.readlines()):
            try:
                prev = json.loads(line.strip())
                if prev.get("totals", {}).get("db_size_bytes"):
                    prev_report = prev
                    break
            except:
                continue

if prev_report:
    prev_size = prev_report["totals"].get("db_size_bytes", 0)
    growth_mb = round((report["totals"]["db_size_bytes"] - prev_size) / 1024 / 1024, 1)
    report["totals"]["growth_mb_since_last"] = growth_mb
    if growth_mb > ALERT_THRESHOLD_MB_PER_DAY:
        report["alerts"].append(f"RAPID GROWTH: DB grew {growth_mb}MB since last check")

# Log
with open(LOG_FILE, 'a') as f:
    f.write(json.dumps(report) + "\n")

# Print summary
print(f"[{now}] DB Growth Monitor")
print(f"  Total DB size: {report['totals']['db_size_mb']}MB")
for table, stats in report["tables"].items():
    print(f"  {table}: {stats['rows']:,} rows, {stats['total_mb']}MB (idx: {stats['index_mb']}MB)")
print(f"  Statement timeouts (24h): {timeout_count}")
if prev_report:
    print(f"  Growth since last: {report['totals'].get('growth_mb_since_last', '?')}MB")

if report["alerts"]:
    print(f"\n  ⚠️  ALERTS ({len(report['alerts'])}):")
    for a in report["alerts"]:
        print(f"    • {a}")
else:
    print("\n  ✅ All healthy")

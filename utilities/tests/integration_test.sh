#!/bin/bash
# Automated integration tests for CT114 deployments (v2 - corrected assertions)

PASS=0
FAIL=0
BASE="http://192.168.1.114:3114"

test_url() {
    local desc="$1"
    local url="$2"
    local expected_code="$3"
    local check_content="$4"
    
    local code
    code=$(curl -s -o /tmp/test_body -w "%{http_code}" "$url")
    
    if [ "$code" = "$expected_code" ]; then
        if [ -n "$check_content" ]; then
            if grep -qi "$check_content" /tmp/test_body; then
                echo "✓ PASS: $desc (HTTP $code, content matched)"
                PASS=$((PASS + 1))
            else
                echo "✗ FAIL: $desc (HTTP $code but missing content: $check_content)"
                FAIL=$((FAIL + 1))
            fi
        else
            echo "✓ PASS: $desc (HTTP $code)"
            PASS=$((PASS + 1))
        fi
    else
        echo "✗ FAIL: $desc (expected $expected_code, got $code)"
        FAIL=$((FAIL + 1))
    fi
}

test_post() {
    local desc="$1"
    local url="$2"
    local expected_code="$3"
    local data="$4"
    
    local code
    code=$(curl -s -o /tmp/test_body -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$data" "$url")
    
    if [ "$code" = "$expected_code" ]; then
        echo "✓ PASS: $desc (HTTP $code)"
        PASS=$((PASS + 1))
    else
        echo "✗ FAIL: $desc (expected $expected_code, got $code)"
        FAIL=$((FAIL + 1))
    fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  CT114 Integration Tests — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "── API Health ──"
test_url "API health check" "$BASE/api/health" "200" '"ok":true'

echo ""
echo "── Games Landing Page ──"
test_url "Games landing serves HTML" "$BASE/games/" "200" "Entertaining Diversions"
test_url "Games landing has LUX card" "$BASE/games/" "200" "lux"
test_url "Games landing has Trish's card" "$BASE/games/" "200" "trishsgames"

echo ""
echo "── LUX Game ──"
test_url "LUX index.html" "$BASE/games/lux/" "200" "html"
test_url "LUX favicon" "$BASE/games/lux/favicon.svg" "200"

echo ""
echo "── Trish's Games ──"
test_url "Trish's index.html" "$BASE/games/trishsgames/" "200" "html"
test_url "Trish's favicon" "$BASE/games/trishsgames/favicon.svg" "200"

echo ""
echo "── PDF Maker Tools Page ──"
test_url "Tools page loads" "$BASE/tools/" "200" "html"

echo ""
echo "── Health Converter ──"
test_url "Health Converter UI" "$BASE/tools/health_converter.html" "200"

echo ""
echo "── Cross-Origin / 404 ──"
test_url "Non-existent game 404" "$BASE/games/nonexistent/" "404"
test_url "Non-existent API 404" "$BASE/api/nonexistent" "404"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
    exit 1
fi

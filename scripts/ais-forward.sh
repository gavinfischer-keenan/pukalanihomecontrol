#!/bin/bash
# AIS NMEA line-by-line forwarder
# Reads from Qudinip AIS receiver at 38400 baud
# Sends each complete NMEA sentence as a UDP packet to CT105 tracker engine

DEVICE=/dev/ttyAIS
TARGET=192.168.1.105
PORT=10110

# Set serial port parameters
stty -F "$DEVICE" 38400 cs8 -cstopb -parenb -echo -onlcr 2>/dev/null

# Read lines and forward to tracker
while IFS= read -r line; do
    # Strip trailing carriage return
    line="${line%$'\r'}"
    # Only forward valid AIS sentences
    if echo "$line" | grep -qE '^!AIVD[MO]'; then
        printf '%s\n' "$line" | socat - "UDP:${TARGET}:${PORT}"
    fi
done < "$DEVICE"

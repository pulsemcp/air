#!/usr/bin/env bash
# Send a Slack notification when an agent session starts.
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"text\": \"Agent session started\"}" \
  "$WEBHOOK_URL"

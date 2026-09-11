#!/bin/bash
# The demo is part of the supervised local stack now: this starts everything
# (API, AI service, web, and the MusicGen service) and prints the demo URL.
exec bash "$(cd "$(dirname "$0")/../.." && pwd)/scripts/dev-up.sh" "$@"

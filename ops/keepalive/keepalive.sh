#!/bin/sh
# Pings each Supabase project so the free tier never pauses it for idleness.
# Both keys are public by design (they ship in the sites' own pages). No secrets.
# Prints "OK <name>" or "FAIL <name> <http status>"; exits non-zero if any fail.

fail=0

ping_check() {
	name="$1"; shift
	code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$@") || code=000
	if [ "$code" = "200" ]; then
		echo "OK $name"
	else
		echo "FAIL $name $code"
		fail=1
	fi
}

ping_check tripp -X POST 	-H 'apikey: sb_publishable_BKvG3mZolQFylaMMtiS9bw_sI1ZUFlq' 	-H 'content-type: application/json' 	-d '{}' 	https://ohhkzjsdabdimlrgnagw.supabase.co/rest/v1/rpc/m_ping

ping_check hope 	-H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqenp1bXp6ZGxzZGZ2eW50bHp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNjM5MzksImV4cCI6MjEwMTczOTkzOX0.K4Ju9X-uqcp1V1ubf6aoxB6X-oRVI97Py-IlrqISc20' 	-H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqenp1bXp6ZGxzZGZ2eW50bHp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNjM5MzksImV4cCI6MjEwMTczOTkzOX0.K4Ju9X-uqcp1V1ubf6aoxB6X-oRVI97Py-IlrqISc20' 	'https://rjzzumzzdlsdfvyntlzu.supabase.co/rest/v1/signature_count?select=*'

ping_check sweep -X POST 	-H 'apikey: sb_publishable_BKvG3mZolQFylaMMtiS9bw_sI1ZUFlq' 	-H 'content-type: application/json' 	-d '{"action":"sweep"}' 	https://ohhkzjsdabdimlrgnagw.supabase.co/functions/v1/media

exit $fail

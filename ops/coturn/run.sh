#!/bin/sh
# Starts coturn on the VM's bridged LAN address (TURN_LAN_IP in .env) with the
# current public IP (behind the home NAT, coturn cannot see it itself) and the
# shared secret from .env. Every 5 minutes it
# checks the public IP and exits if it changed, so Docker restarts it with the
# new one; once a day it tells coturn to reload the TLS certificate (SIGUSR2)
# so certbot renewals take effect.
set -eu
[ -n "${TURN_SECRET:-}" ] || { echo 'run.sh: TURN_SECRET is not set' >&2; exit 1; }
[ -n "${TURN_LAN_IP:-}" ] || { echo 'run.sh: TURN_LAN_IP is not set' >&2; exit 1; }
case " $(hostname -I) " in
	*" $TURN_LAN_IP "*) ;;
	*) echo "run.sh: $TURN_LAN_IP is not an address of this machine ($(hostname -I))" >&2; exit 1 ;;
esac
ip=$(detect-external-ip)
[ -n "$ip" ] || { echo 'run.sh: no public IP' >&2; exit 1; }
echo "run.sh: public IP $ip, LAN IP $TURN_LAN_IP"

turnserver -c /etc/coturn/turnserver.conf \
	--listening-ip="$TURN_LAN_IP" --relay-ip="$TURN_LAN_IP" \
	--external-ip="$ip/$TURN_LAN_IP" --denied-peer-ip="$ip" --static-auth-secret="$TURN_SECRET" &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT

ticks=0
while kill -0 "$pid" 2>/dev/null; do
	sleep 300 & wait $! || true
	kill -0 "$pid" 2>/dev/null || break
	now=$(detect-external-ip 2>/dev/null || true)
	if [ -n "$now" ] && [ "$now" != "$ip" ]; then
		echo "run.sh: public IP changed to $now, restarting"
		kill -TERM "$pid"
		wait "$pid" || true
		exit 1
	fi
	ticks=$((ticks + 1))
	if [ "$ticks" -ge 288 ]; then
		ticks=0
		kill -USR2 "$pid" 2>/dev/null || true
	fi
done
wait "$pid"

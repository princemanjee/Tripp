# coturn relay (Mac Studio)

Last-resort TURN relay for Tripp calls at `coturn.princerehman.com`.

It runs in a Lima Linux VM (`lima.yaml`), not on Docker Desktop: Docker Desktop on
macOS rewrites the source address of every incoming UDP packet to 192.168.65.1, so
coturn's peer permissions never match and relayed media is dropped. The VM is bridged
onto the home LAN (en0) with MAC `52:55:55:1a:7c:63`, reserved at **10.0.0.230**, and
coturn uses the VM's network directly. Router forwards point at 10.0.0.230.

## Files

- `turnserver.conf` — listeners 3478 UDP/TCP and 5349 TLS, relay ports 49160-49200 UDP,
  time-limited credentials only, private/loopback/reserved peers refused.
- `run.sh` — starts coturn with the current public IP as `external-ip` (and denies it as a
  peer), restarts coturn if that IP changes, reloads the TLS cert daily.
- `coturn-vm.applescript` — the desktop app *Coturn VM* (status, start, stop). Build:
  `osacompile -o ~/Desktop/"Coturn VM.app" ops/coturn/coturn-vm.applescript`
- `deploy-hook.sh` — certbot hook that copies a renewed cert into `certs/live/`.
- `lima.yaml` — the VM: Ubuntu, rootful Docker, this folder mounted at `/srv/coturn`.
- `.env` (not in git) — `TURN_SECRET=<64 hex>` and `TURN_LAN_IP=10.0.0.230`. The secret is
  also the Edge Function secret `TURN_SECRET` of the `turn` function.
- `certs/` (not in git) — `live/` is what coturn reads, `letsencrypt/` is certbot's state.

## One-time setup (Mac)

    brew install lima socket_vmnet
    sudo mkdir -p /opt/socket_vmnet/bin
    sudo install -o root -g wheel -m 755 /opt/homebrew/opt/socket_vmnet/bin/socket_vmnet /opt/socket_vmnet/bin/socket_vmnet
    # ~/.lima/_config/networks.yaml: paths.socketVMNet: /opt/socket_vmnet/bin/socket_vmnet
    limactl sudoers | sudo tee /etc/sudoers.d/lima >/dev/null
    limactl create --name=coturn ops/coturn/lima.yaml
    limactl start coturn
    limactl autostart enable coturn   # optional: start the VM at login
    printf 'TURN_SECRET=%s\nTURN_LAN_IP=10.0.0.230\n' "$(openssl rand -hex 32)" > ops/coturn/.env

## Start

Docker commands run inside the VM, from `/srv/coturn`:

    limactl shell --workdir /srv/coturn coturn -- sudo docker compose up -d coturn

Start and stop the VM with the *Coturn VM* desktop app (or `limactl start|stop coturn`).
coturn and certbot come up by themselves when the VM boots. Autostart at login is off.

Until the real cert is issued, `certs/live/` holds a self-signed placeholder, so `turns:`
(5349) will not be trusted by browsers; `turn:` on 3478 works without it.

## Issue the Let's Encrypt cert (needs the DNS record and port 80 forwarded)

    limactl shell --workdir /srv/coturn coturn -- sudo docker compose run --rm --entrypoint certbot certbot \
      certonly --standalone -d coturn.princerehman.com --agree-tos --register-unsafely-without-email \
      --deploy-hook /deploy-hook.sh
    limactl shell --workdir /srv/coturn coturn -- sudo docker compose up -d certbot
    limactl shell --workdir /srv/coturn coturn -- sudo docker compose exec coturn sh -c 'kill -USR2 $(cat /var/tmp/turnserver.pid)'

The `certbot` service then renews twice a day when due; `run.sh` reloads the cert daily.

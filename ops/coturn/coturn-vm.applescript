-- Coturn VM: start, stop or check the Tripp coturn relay VM (Lima instance "coturn").
-- Build the desktop app with:
--   osacompile -o ~/Desktop/"Coturn VM.app" ops/coturn/coturn-vm.applescript
-- coturn and certbot start by themselves when the VM boots (restart: unless-stopped).

property limactl : "/opt/homebrew/bin/limactl"
property appTitle : "Coturn VM"

on vmStatus()
	try
		return do shell script limactl & " list coturn --format '{{.Status}}'"
	on error
		return "Missing"
	end try
end vmStatus

on relayStatus()
	try
		return do shell script limactl & " shell --workdir /srv/coturn coturn -- sudo docker compose ps --all --format '{{.Service}}: {{.Status}}'"
	on error
		return "Relay status not available yet."
	end try
end relayStatus

on startVm()
	display notification "Starting the coturn VM, about a minute." with title appTitle
	do shell script limactl & " start --tty=false coturn"
	display dialog "The coturn VM is running." & return & return & relayStatus() with title appTitle buttons {"OK"} default button "OK"
end startVm

on stopVm(force)
	if force then
		do shell script limactl & " stop -f coturn"
	else
		do shell script limactl & " stop coturn"
	end if
	display notification "The coturn VM is stopped." with title appTitle
end stopVm

try
	set vmState to vmStatus()
	if vmState is "Running" then
		set choice to button returned of (display dialog "The coturn VM is running." & return & return & relayStatus() with title appTitle buttons {"Close", "Stop VM"} default button "Close")
		if choice is "Stop VM" then stopVm(false)
	else if vmState is "Stopped" then
		set choice to button returned of (display dialog "The coturn VM is stopped." with title appTitle buttons {"Close", "Start VM"} default button "Start VM")
		if choice is "Start VM" then startVm()
	else if vmState is "Missing" then
		display dialog "There is no Lima instance named coturn. See ops/coturn/README.md." with title appTitle buttons {"OK"} default button "OK"
	else
		set choice to button returned of (display dialog "The coturn VM is " & vmState & "." with title appTitle buttons {"Close", "Force restart"} default button "Force restart")
		if choice is "Force restart" then
			stopVm(true)
			startVm()
		end if
	end if
on error errText number errNum
	if errNum is not -128 then
		display dialog "Something went wrong:" & return & return & errText with title appTitle buttons {"OK"} default button "OK" with icon stop
	end if
end try

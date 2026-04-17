export function printUsage() {
	console.log(
		"Usage: oc <start|stop|restart|status|tui|browser|dev|agent|config|session>\n" +
			"       oc agent <list|create|config|rename|remove|ask|name>\n" +
			"       oc config runtime [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N]\n" +
			"       oc config secure\n" +
			"       oc session list [--limit N] [--tag cron]\n" +
			"       oc session search <query> [--limit N]\n" +
			"       oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
	);
}

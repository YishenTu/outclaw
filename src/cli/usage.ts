export function printUsage() {
	console.log(
		"Usage: oc <start|stop|restart|status|tui|dev|agent|config|session>\n" +
			"       oc agent <list|create|config|rename|remove|name>\n" +
			"       oc config secure\n" +
			"       oc session list [--limit N] [--tag cron]\n" +
			"       oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
	);
}

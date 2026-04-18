const BANNER = ` ██████╗ ██╗   ██╗████████╗ ██████╗██╗      █████╗ ██╗    ██╗
██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██║     ██╔══██╗██║    ██║
██║   ██║██║   ██║   ██║   ██║     ██║     ███████║██║ █╗ ██║
██║   ██║██║   ██║   ██║   ██║     ██║     ██╔══██║██║███╗██║
╚██████╔╝╚██████╔╝   ██║   ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝  ╚═════╝    ╚═╝    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ `;

export function WelcomePage() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-dark-950 px-6">
			<pre className="font-mono font-bold leading-[1.05] text-brand text-[clamp(8px,1.4vw,16px)]">
				{BANNER}
			</pre>
		</div>
	);
}

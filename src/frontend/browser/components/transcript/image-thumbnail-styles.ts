export function getImageThumbnailClassName(
	surface: "composer" | "message",
): string {
	return surface === "composer"
		? "block h-auto max-h-16 w-auto max-w-[6rem] rounded-md border border-dark-700 bg-dark-950/60 object-contain"
		: "block h-auto max-h-24 w-auto max-w-[14rem] rounded-md border border-dark-700 bg-dark-950/60 object-contain";
}

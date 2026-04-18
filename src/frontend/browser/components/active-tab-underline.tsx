export const ACTIVE_TAB_UNDERLINE_CLASS =
	"absolute inset-x-0 bottom-0 -mb-px h-px bg-brand";

export function ActiveTabUnderline() {
	return <span aria-hidden="true" className={ACTIVE_TAB_UNDERLINE_CLASS} />;
}

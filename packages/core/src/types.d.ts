declare module "turndown" {
	interface Options {
		headingStyle?: "setext" | "atx";
		codeBlockStyle?: "indented" | "fenced";
	}
	class TurndownService {
		constructor(options?: Options);
		turndown(html: string): string;
	}
	export default TurndownService;
}

declare module "streammark";

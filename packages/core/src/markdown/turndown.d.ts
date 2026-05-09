declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: string;
    codeBlockStyle?: string;
  }
  export default class TurndownService {
    constructor(options?: TurndownOptions);
    turndown(html: string): string;
  }
}

import { z } from "zod";
import { BaseModelRunner } from "../src/models/runner.js";
import { ModelDetails } from "../src/models/types.js";
import { Conversation } from "../src/conversation/conversation.js";
import { ModelResponse } from "../src/models/types.js";
import { EvaluationRunner } from "../src/evaluation/runner.js";
import { Prompt } from "../src/conversation/prompt.js";
import { fromHtmlViaMarkify, fromHtmlViaModel } from "../src/markdown/from_html.js";

const siteInfoSchema = z.object({
  'siteName': z.string().describe('The name of the site'),
  'siteUrl': z.string().describe('The url of the site'),
  'siteDescription': z.string().describe('A description of the site'),
  'siteKeywords': z.array(z.string()).describe('The keywords of the site'),
  'feedUrl': z.string().describe('The url of the site\'s RSS feed'),
  categories: z.array(z.object({
    'name': z.string().describe('The name of the category'),
    'url': z.string().describe('The full url including hostname of the category'),
  })),
  entries: z.array(z.object({
    'title': z.string().describe('The title of the entry'),
    'url': z.string().describe('The full url including hostname of the entry'),
    'description': z.string().describe('A description of the entry'),
    'category': z.string().describe('The category of the entry'),
    'published': z.string().describe('The date the entry was published in YYYY-MM-DD format'),
    'author': z.string().describe('The author of the entry'),
  })),
});

export async function getSiteInfo(html:string, model:ModelDetails): Promise<ModelResponse> {
  const prompt = new Prompt();
  prompt.setRole('expert web scraper');
  prompt.addInstruction('You will be given a html page and you will need to extract the information from the page.');
  prompt.addInstruction(`The currrent date is ${new Date().toISOString()}`);
  prompt.addInstruction(`Dont make up any information, only use the information provided in the html page.`);

  prompt.setObjective(`Please parse the html and return the structure of the page`);

  console.log(prompt.getPrompt());
  const conversation = new Conversation(model, prompt.getPrompt());
  conversation.addMessage({ role: 'user', content: html });
  // conversation.addMessage({
  //   role: 'user',
  //   content: `Please parse the html and return the structure of the page`
  // });

  const modelRunner = new BaseModelRunner();
  const response = await modelRunner.streamObject(conversation, siteInfoSchema);
  return response;
}



class SiteInfoEvaluator extends EvaluationRunner {
  private readonly url: string;
  constructor(evaluationId: string, url: string) {
    super(evaluationId);
    this.url = url;
  }

  async getHtml(url: string,key: string) {
    return this.getCachedFile(key, async () => {
      const html = await fetch(url, {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      return html.text();
    });
  }
  async getMarkdown(url:string,key:string) {
    return this.getCachedFile(key, async () => {
      const html = await this.getHtml(url, "root.html");
      // return fromHtmlViaMarkify(html);
      return fromHtmlViaModel(html, {
        name: "gemini-2.0-flash",
        provider: "google",
      });
    });
  }

  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    const html = await this.getHtml(this.url, "root.html");
    return getSiteInfo(html, details);
  }
}

const urls = [
  ['site-info/thefocus', 'https://thefocus.ai'],
  ['site-info/turingpost', 'https://turingpost.com'],
]

for (const [evaluationId, url] of urls) {
  const runner = new SiteInfoEvaluator(evaluationId, url);

  const markdown = await runner.getMarkdown( url, "root.md");
  console.log(markdown);

  await runner.evaluate({
    name: 'gemini-2.0-flash',
    provider: 'google',
  });

  await runner.evaluate({
    name: 'gemini-2.5-pro-exp-03-25',
    provider: 'google',
  });

  await runner.evaluate({
    name: 'gemini-1.5-flash-8b',
    provider: 'google',
  });

  await runner.evaluate({
    name: 'gemma3:12b',
    provider: 'ollama',
  });

}
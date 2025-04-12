import { BaseModelRunner } from '../src/models/runner.js';
import { ModelDetails } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import fs from 'fs';
import { zodToJsonSchema } from 'zod-to-json-schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SiteInfoExtractor {
  private static readonly siteInfoSchema = z.object({
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

  private readonly outputDir: string;
  private readonly htmlFile: string;
  private readonly modelResponseFile: string;
  private readonly model: ModelDetails = {
    name: 'gemini-2.0-flash',
    provider: 'google',
  };

  constructor(private readonly siteUrl: string, private readonly siteName: string) {
    this.outputDir = path.resolve(__dirname, '../output/sites', this.siteName);
    this.htmlFile = path.resolve(this.outputDir, 'site.html');
    this.modelResponseFile = path.resolve(this.outputDir, 'model-response.json');
  }

  private async getSiteHtml(): Promise<string> {
    if (fs.existsSync(this.htmlFile)) {
      return fs.readFileSync(this.htmlFile, 'utf8');
    }

    console.log('Fetching site html...');
    const response = await fetch(this.siteUrl);
    const html = await response.text();
    
    const dir = path.dirname(this.htmlFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.htmlFile, html);
    return html;
  }

  public async extract() {
    try {
      if (fs.existsSync(this.modelResponseFile)) {
        const modelResponse = fs.readFileSync(this.modelResponseFile, 'utf8');
        return JSON.parse(modelResponse);
      }

      const html = await this.getSiteHtml();
      const prompt = `You are an expert in information extraction. You will be given a html page and you will need to extract the information from the page. The currrent date is ${new Date().toISOString()}`;

      const conversation = new Conversation(this.model, prompt);
      conversation.addMessage({ role: 'user', content: html });
      conversation.addMessage({
        role: 'user',
        content: `Please parse the html and return the structure of the page`
      });

      const modelRunner = new BaseModelRunner();
      const response = await modelRunner.streamObject(conversation, SiteInfoExtractor.siteInfoSchema);

      fs.writeFileSync(this.modelResponseFile, JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      console.error(`Error extracting info from ${this.siteUrl}:`, error);
      throw error;
    }
  }
}

// Example usage
const extractor = new SiteInfoExtractor('https://thefocus.ai', 'thefocus');
extractor.extract().then((siteInfo) => {
  console.log(siteInfo);
  process.exit(0);
}).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

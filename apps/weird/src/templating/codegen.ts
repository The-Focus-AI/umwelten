import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

export async function generateProject({ outDir, projectName, parsingSpec, domainSpec }: { outDir: string; projectName: string; parsingSpec: any; domainSpec: any }) {
	if (fs.existsSync(outDir)) {
		throw Object.assign(new Error(`Output directory already exists: ${outDir}`), { code: 3 });
	}
	fs.mkdirSync(outDir, { recursive: true });

	const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates');
	const read = (p: string) => fs.readFileSync(path.join(templatesDir, p), 'utf-8');
	const write = (p: string, content: string | Buffer) => {
		const full = path.join(outDir, p);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content);
	};

	// package.json
	const pkgTpl = Handlebars.compile(read('package.hbs'));
	write('package.json', pkgTpl({ projectName }));
	write('tsconfig.json', read('tsconfig.json'));
	write('.env.example', read('.env.example'));
	write('README.md', Handlebars.compile(read('README.hbs'))({ projectName }));

	// src
	write('src/server.ts', read('src/server.ts'));
	write('src/db/connection.ts', read('src/db/connection.ts'));
	write('src/ingest/parsingSpec.json', JSON.stringify(parsingSpec, null, 2));
	write('src/ingest/ingestCsv.ts', read('src/ingest/ingestCsv.ts'));
	write('src/tools/generic.ts', read('src/tools/generic.ts'));
	write('src/tools/domain.ts', Handlebars.compile(read('src/tools/domain.hbs'))({ domainSpec: JSON.stringify(domainSpec) }));
	write('src/llm/client.ts', read('src/llm/client.ts'));
}
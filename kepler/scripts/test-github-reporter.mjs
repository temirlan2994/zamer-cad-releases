// Ошибки node:test в аннотациях GitHub Checks рядом с исходным файлом.
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const escapeData = (value) => String(value ?? '').replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (value) => escapeData(value).replaceAll(',', '%2C').replaceAll(':', '%3A');

export default async function* githubReporter(events) {
  for await (const { type, data } of events) {
    if (type !== 'test:fail' || data.details?.error?.failureType === 'subtestsFailed') continue;
    const error = data.details?.error, cause = error?.cause || error;
    const file = data.file?.startsWith('file:') ? fileURLToPath(data.file) : data.file;
    const location = file ? `file=${escapeProperty(relative(process.env.GITHUB_WORKSPACE || process.cwd(), file))},line=${data.line || 1},` : '';
    const message = [data.name, cause?.message || error?.message, cause?.stack].filter(Boolean).join('\n').slice(0, 10000);
    yield `::error ${location}title=${escapeProperty(data.name)}::${escapeData(message)}\n`;
  }
}
